/**
 * Live-score pipeline — The Odds API /scores endpoint (the ONLY provider).
 *
 * Every /live page render and the cron sync calls refreshLiveScores(); the
 * in-process throttle guarantees at most ONE /scores request per active
 * league per window, so visitors can't hammer the quota.
 *
 * How it works:
 *   1. Candidate games = rows already LIVE/HALF_TIME, plus rows whose kickoff
 *      passed within the last LIVE_LOOKBACK_HOURS (in-play or just finished
 *      but never marked).
 *   2. Candidates map to Odds API sport keys via competitionName →
 *      LEAGUE_TITLES reverse lookup (no schema change needed).
 *   3. GET /v4/sports/{sport}/scores for those leagues only (usually 1–3
 *      requests per sweep). The `daysFrom` parameter is OMITTED during live
 *      polling — per the v4 docs that returns only live + upcoming games at
 *      cost 1/league (vs 2 with daysFrom). Leagues that still hold LIVE rows
 *      are the exception: they add `daysFrom=1` (narrowed by eventIds) so the
 *      `completed` flag can flip finished games immediately.
 *   4. Every returned event is UPSERTED by externalId — rows for started
 *      games the pre-match sync never ingested are CREATED here (the /scores
 *      payload carries team names + commence_time), marked LIVE, with an
 *      ESTIMATED clock (The Odds API exposes no match minute — derived from
 *      commence_time; the `completed` flag + scores are authoritative).
 *   5. Finished events are marked FINISHED with live:false, ready for the
 *      auto-settle cron.
 *   6. In-play ODDS refresh (separate throttle, `LIVE_ODDS_THROTTLE_SECONDS`,
 *      markets `ODDS_API_LIVE_MARKETS`): ONE call to
 *      /v4/sports/upcoming/odds?eventIds=<live ids> fetches moving prices for
 *      every live game across leagues (cost = markets × regions = 1, not
 *      1/league) — upsertInPlayOdds() refreshes existing live games' markets
 *      (never scores/status; settled markets stay untouched). Skipped
 *      entirely when nothing is live.
 *
 * Quota: 1 request per candidate league (2 for leagues with live rows) + 1
 * per live-odds refresh. Response headers x-requests-remaining/-used/-last
 * are logged per call and persisted to Setting `odds.lastQuota`.
 * Default sweep window 300s; live-odds window 900s.
 */
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { TheOddsApi, getLastQuota } from "./providers/odds-api";
import { resolveSportSlug, upsertInPlayOdds } from "./sync";
import { reconcileOrphanLiveGames } from "./orphan-live";
import { LEAGUE_TITLES } from "./league-titles";

let lastRefresh = 0;
let lastOddsRefresh = 0;

/** League display-title → sport key reverse map, enriched from the live
 *  sports list (covers leagues added after the static LEAGUE_TITLES). The
 *  /sports list endpoint is quota-free. */
let titleMapCache: { at: number; map: Map<string, string> } | null = null;
async function leagueTitleToKey(): Promise<Map<string, string>> {
  const ttl = 60 * 60_000;
  if (titleMapCache && Date.now() - titleMapCache.at < ttl) return titleMapCache.map;
  const map = new Map(Object.entries(LEAGUE_TITLES).map(([k, v]) => [v, k]));
  try {
    const provider = new TheOddsApi();
    for (const sp of await provider.fetchSports()) {
      if (!map.has(sp.name)) map.set(sp.name, sp.key);
    }
  } catch {
    /* static map suffices on failure */
  }
  titleMapCache = { at: Date.now(), map };
  return map;
}

/** Live pipeline knobs are DB-driven (Admin → API Settings → Live scores &
 *  in-play odds); env vars override when set. Resolved per sweep so admin
 *  saves apply on the next sweep without a restart.
 *
 *  Defaults (keep cheapest): scores sweep ≤300s, in-play odds refresh ≤900s
 *  at h2h only — ~4 credits/hr per league with live games at regions=eu. */
async function liveConfig() {
  const s = await getSettings();
  const envThrottle = Number(process.env.LIVE_SCORES_THROTTLE_SECONDS);
  const envOdds = Number(process.env.LIVE_ODDS_THROTTLE_SECONDS);
  const envLookback = Number(process.env.LIVE_SCORES_LOOKBACK_HOURS);
  const envMarkets = process.env.ODDS_API_LIVE_MARKETS?.split(",").map((x) => x.trim()).filter(Boolean);
  return {
    lookbackHours: process.env.LIVE_SCORES_LOOKBACK_HOURS !== undefined && Number.isFinite(envLookback) && envLookback > 0
      ? Math.round(envLookback)
      : s.liveLookbackHours || 4,
    scoresThrottleSeconds: process.env.LIVE_SCORES_THROTTLE_SECONDS !== undefined && Number.isFinite(envThrottle) && envThrottle > 0
      ? Math.round(envThrottle)
      : s.liveScoresThrottleSeconds || 300,
    oddsThrottleSeconds: process.env.LIVE_ODDS_THROTTLE_SECONDS !== undefined && Number.isFinite(envOdds) && envOdds > 0
      ? Math.round(envOdds)
      : s.liveOddsThrottleSeconds || 900,
    oddsMarkets: (envMarkets && envMarkets.length ? envMarkets : s.liveOddsMarkets.length ? s.liveOddsMarkets : ["h2h"]) as readonly string[],
  };
}

export async function refreshLiveScores(): Promise<{
  updated: number;
  created: number;
  oddsUpdated: number;
  skipped: boolean;
  leagues: string[];
  orphanDeleted?: number;
  stuckManual?: number;
  staleFinished?: number;
  quotaRemaining?: number | null;
  quotaUsed?: number | null;
  quotaCost?: number | null;
}> {
  const live = await liveConfig();
  const windowMs = Math.max(10, live.scoresThrottleSeconds * 1000);
  const now = Date.now();

  // Cross-process coordination: Railway Cron hits and /live visitor sweeps
  // drive this from different processes, so the throttle is mirrored in the
  // DB (Setting: live.lastSweepAt). Without it the two orchestrators would
  // double-spend API credits.
  let lastDb = 0;
  try {
    const marker = await prisma.setting.findUnique({ where: { key: "live.lastSweepAt" } });
    lastDb = marker ? Number(marker.value) || 0 : 0;
  } catch {
    /* marker unavailable — fall back to the in-process throttle */
  }
  if (now - Math.max(lastRefresh, lastDb) < windowMs) {
    return { updated: 0, created: 0, oddsUpdated: 0, skipped: true, leagues: [] };
  }

  // Record the attempt even on failure — acts as a backoff so a quota window
  // doesn't get re-hit on every poll.
  lastRefresh = now;
  try {
    await prisma.setting.upsert({
      where: { key: "live.lastSweepAt" },
      update: { value: String(now) },
      create: { key: "live.lastSweepAt", value: String(now) },
    });
  } catch {
    /* non-fatal */
  }

  try {
    const provider = new TheOddsApi();

    // 1) Candidate games in the DB (live now, or kicked off within the window).
    //    Only API-linked rows matter — manual/seed rows carry no externalId and
    //    are handled by the orphan reconciler, never by this pass.
    const candidates = await prisma.game.findMany({
      where: {
        externalId: { not: null },
        OR: [
          { status: { in: ["LIVE", "HALF_TIME", "IN_PLAY"] } },
          {
            status: "SCHEDULED",
            startAt: { gte: new Date(now - live.lookbackHours * 3600_000), lte: new Date(now) },
          },
        ],
      },
      select: { externalId: true, competitionName: true, status: true },
    });

    // 2) Map candidates → Odds API sport keys (reverse of LEAGUE_TITLES,
    //    enriched with the live sports list for auto-mapped leagues).
    const titleToKey = await leagueTitleToKey();
    const leagueKeys = new Set<string>();
    // Leagues that still hold LIVE rows need `daysFrom=1` (completed games are
    // only returned with that parameter) — narrowed to our live event ids.
    const completedFor = new Set<string>();
    const eventIdsFor: Record<string, string[]> = {};
    for (const g of candidates) {
      const key = g.competitionName ? titleToKey.get(g.competitionName) : undefined;
      if (!key) continue;
      leagueKeys.add(key);
      if (g.externalId && ["LIVE", "HALF_TIME", "IN_PLAY"].includes(g.status)) {
        completedFor.add(key);
        (eventIdsFor[key] ??= []).push(g.externalId);
      }
    }
    if (leagueKeys.size === 0) return { updated: 0, created: 0, oddsUpdated: 0, skipped: false, leagues: [] };

    // 3) Fetch scores. `daysFrom` omitted for pure live polling (docs: live +
    //    upcoming only, cost 1/league); added only where a completed flag is
    //    needed to settle a live row promptly.
    const scores = await provider.fetchLiveScores([...leagueKeys], {
      completedFor: [...completedFor],
      eventIdsFor,
    });

    // 4) Upsert every scored event by externalId. Only events that have
    //    COMMENCED are created (upcoming events belong to the pre-match sync —
    //    creating them here as LIVE would put future matches on /live). Manual
    //    rows are invisible to this pass because they have no externalId.
    let updated = 0;
    let created = 0;
    const liveAfter = new Set<string>(); // externalIds live at the end of this pass
    for (const score of scores) {
      const sportSlug = score.sportKey ? resolveSportSlug(score.sportKey) : "football";
      const sport = await prisma.sport.findUnique({ where: { slug: sportSlug } });
      if (!sport) continue;

      const finished = score.status === "finished";
      const liveNow = score.status === "live";
      if (liveNow) liveAfter.add(score.externalId);

      const existing = await prisma.game.findUnique({ where: { externalId: score.externalId } });
      if (existing) {
        const wasLive = ["LIVE", "HALF_TIME", "IN_PLAY"].includes(existing.status);
        // Never downgrade a commenced fixture to SCHEDULED: per the docs an
        // event with commence_time <= now is in-play even when the payload has
        // no scores yet — marking it SCHEDULED would drop it off /live.
        if (!finished && !liveNow && wasLive) continue;
        await prisma.game.update({
          where: { id: existing.id },
          data: {
            ...(score.homeScore !== undefined ? { homeScore: score.homeScore } : {}),
            ...(score.awayScore !== undefined ? { awayScore: score.awayScore } : {}),
            status: finished ? "FINISHED" : liveNow ? "LIVE" : "SCHEDULED",
            ...(finished ? { live: false, clock: null, period: null } : {}),
            ...(liveNow ? { live: true, clock: score.clock ?? null, period: score.period ?? null } : {}),
          },
        });
        updated++;
      } else if (score.status !== "scheduled" && score.homeName && score.awayName && score.startAt) {
        // Commenced after the last pre-match sync → create the row here.
        await prisma.game.create({
          data: {
            sportId: sport.id,
            competitionName: score.sportKey ? LEAGUE_TITLES[score.sportKey] ?? null : null,
            homeName: score.homeName,
            awayName: score.awayName,
            startAt: score.startAt,
            status: finished ? "FINISHED" : "LIVE",
            live: !finished,
            homeScore: score.homeScore ?? 0,
            awayScore: score.awayScore ?? 0,
            clock: liveNow ? score.clock ?? null : null,
            period: liveNow ? score.period ?? null : null,
            externalId: score.externalId,
            source: "API",
          },
        });
        created++;
      }
    }

    // 5) In-play ODDS refresh (own throttle). ONE call for every live event:
    //    the `upcoming` pseudo-sport is valid on /odds, and eventIds filters it
    //    to our games — cost = markets × regions = 1 total (per-league calls
    //    would cost 1 each). No live events ⇒ no request at all.
    let oddsUpdated = 0;
    const oddsWindowMs = Math.max(10, live.oddsThrottleSeconds * 1000);
    const liveEventIds = [...liveAfter];
    if (liveEventIds.length && Date.now() - lastOddsRefresh >= oddsWindowMs) {
      lastOddsRefresh = Date.now(); // backoff even on failure (quota-safe)
      try {
        const liveOdds = await provider.fetchUpcomingGames(["upcoming"], live.oddsMarkets, {
          eventIds: liveEventIds,
        });
        oddsUpdated = (await upsertInPlayOdds(liveOdds)).updated;
      } catch (e) {
        console.error("[live-scores] in-play odds refresh failed:", e instanceof Error ? e.message : e);
      }
    }

    // 6) Orphan cleanup: seeded/manual demo rows stuck LIVE (no externalId,
    //    no bets, no admin markets, kickoff >6h ago) are deleted so only
    //    API-driven live games remain visible. Genuine manual fixtures are
    //    reported for the admin to finish instead of being touched.
    let orphanDeleted = 0;
    let stuckManual = 0;
    let staleFinished = 0;
    try {
      const orphan = await reconcileOrphanLiveGames();
      orphanDeleted = orphan.orphanDeleted;
      stuckManual = orphan.stuckManual;
      staleFinished = orphan.staleFinished;
    } catch (e) {
      console.error("[live-scores] orphan cleanup failed:", e instanceof Error ? e.message : e);
    }

    // Quota telemetry — last snapshot from the API response headers.
    const quota = getLastQuota();
    if (quota) {
      try {
        await prisma.setting.upsert({
          where: { key: "odds.lastQuota" },
          update: { value: JSON.stringify(quota) },
          create: { key: "odds.lastQuota", value: JSON.stringify(quota) },
        });
      } catch {
        /* telemetry must never fail a sweep */
      }
    }

    return {
      updated,
      created,
      oddsUpdated,
      skipped: false,
      leagues: [...leagueKeys],
      orphanDeleted,
      stuckManual,
      staleFinished,
      quotaRemaining: quota?.remaining ?? null,
      quotaUsed: quota?.used ?? null,
      quotaCost: quota?.last ?? null,
    };
  } catch (e) {
    console.error("[live-scores] sweep failed:", e instanceof Error ? e.message : e);
    return { updated: 0, created: 0, oddsUpdated: 0, skipped: false, leagues: [] };
  }
}
