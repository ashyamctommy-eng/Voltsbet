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
 *   3. GET /v4/sports/{sport}/scores?daysFrom=1 for those leagues only
 *      (usually 1–3 requests per sweep).
 *   4. Every returned event is UPSERTED by externalId — rows for started
 *      games the pre-match sync never ingested are CREATED here (the /scores
 *      payload carries team names + commence_time), marked LIVE, with an
 *      ESTIMATED clock (The Odds API exposes no match minute — derived from
 *      commence_time; the `completed` flag + scores are authoritative).
 *   5. Finished events are marked FINISHED with live:false, ready for the
 *      auto-settle cron.
 *   6. In-play ODDS refresh (separate throttle, `LIVE_ODDS_THROTTLE_SECONDS`,
 *      markets `ODDS_API_LIVE_MARKETS`): /odds returns live events with
 *      moving prices — upsertInPlayOdds() refreshes existing live games'
 *      market odds (never scores/status; settled markets stay untouched).
 *
 * Quota: ~1 request per active league per sweep (+1 per live-odds refresh
 * per market). Default sweep window 300s; live-odds window 900s.
 */
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { TheOddsApi } from "./providers/odds-api";
import { SPORT_KEY_MAP, upsertInPlayOdds } from "./sync";
import { LEAGUE_TITLES } from "./feed";

let lastRefresh = 0;
let lastOddsRefresh = 0;

const LIVE_LOOKBACK_HOURS = Number(process.env.LIVE_SCORES_LOOKBACK_HOURS ?? 4) || 4;
/** Min seconds between provider sweeps (independent of the UI poll interval). */
const THROTTLE_SECONDS = Number(process.env.LIVE_SCORES_THROTTLE_SECONDS ?? 300) || 300;
/** Min seconds between in-play ODDS refreshes (separate from the scores
 *  throttle — odds cost 1 credit per market per league per call).
 *  Default 900s (15 min) at the default 1 market (h2h) keeps a paid 20K plan
 *  comfortable: ~4 sweeps/hr × active leagues. */
const LIVE_ODDS_THROTTLE_SECONDS = Number(process.env.LIVE_ODDS_THROTTLE_SECONDS ?? 900) || 900;
/** Markets for the live-odds refresh (h2h only by default — cheapest and the
 *  one in-play price every bookmaker serves; enrich via
 *  "h2h,spreads,totals" if quota allows). */
const LIVE_ODDS_MARKETS = (
  process.env.ODDS_API_LIVE_MARKETS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["h2h"]
) as readonly string[];

export async function refreshLiveScores(): Promise<{
  updated: number;
  created: number;
  oddsUpdated: number;
  skipped: boolean;
  leagues: string[];
}> {
  const s = await getSettings();
  const windowMs = Math.max(10, THROTTLE_SECONDS * 1000);
  const now = Date.now();
  if (now - lastRefresh < windowMs) return { updated: 0, created: 0, oddsUpdated: 0, skipped: true, leagues: [] };

  // Record the attempt even on failure — acts as a backoff so a quota window
  // doesn't get re-hit on every poll.
  lastRefresh = now;

  try {
    const provider = new TheOddsApi();

    // 1) Candidate games in the DB (live now, or kicked off within the window).
    const candidates = await prisma.game.findMany({
      where: {
        OR: [
          { status: { in: ["LIVE", "HALF_TIME"] } },
          {
            status: "SCHEDULED",
            startAt: { gte: new Date(now - LIVE_LOOKBACK_HOURS * 3600_000), lte: new Date(now) },
          },
        ],
      },
      select: { competitionName: true },
    });

    // 2) Map candidates → Odds API sport keys (reverse of LEAGUE_TITLES).
    const titleToKey = new Map(Object.entries(LEAGUE_TITLES).map(([k, v]) => [v, k]));
    const leagueKeys = new Set<string>();
    for (const g of candidates) {
      const key = g.competitionName ? titleToKey.get(g.competitionName) : undefined;
      if (key) leagueKeys.add(key);
    }
    if (leagueKeys.size === 0) return { updated: 0, created: 0, oddsUpdated: 0, skipped: false, leagues: [] };

    // 3) Fetch scores for the active leagues only.
    const scores = await provider.fetchLiveScores([...leagueKeys]);

    // 4) Upsert every scored event by externalId.
    let updated = 0;
    let created = 0;
    for (const score of scores) {
      const sportSlug = score.sportKey ? SPORT_KEY_MAP[score.sportKey] : "football";
      const sport = await prisma.sport.findUnique({ where: { slug: sportSlug } });
      if (!sport) continue;

      const finished = score.status === "finished";
      const live = score.status === "live";

      const existing = await prisma.game.findUnique({ where: { externalId: score.externalId } });
      if (existing) {
        await prisma.game.update({
          where: { id: existing.id },
          data: {
            ...(score.homeScore !== undefined ? { homeScore: score.homeScore } : {}),
            ...(score.awayScore !== undefined ? { awayScore: score.awayScore } : {}),
            status: finished ? "FINISHED" : live ? "LIVE" : "SCHEDULED",
            ...(finished ? { live: false, clock: null, period: null } : {}),
            ...(live ? { live: true, clock: score.clock ?? null, period: score.period ?? null } : {}),
          },
        });
        updated++;
      } else if (score.homeName && score.awayName && score.startAt) {
        // Started after the last pre-match sync → create the row here.
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
            clock: live ? score.clock ?? null : null,
            period: live ? score.period ?? null : null,
            externalId: score.externalId,
            source: "API",
          },
        });
        created++;
      }
    }

    // 5) In-play ODDS refresh (separate throttle + market set): /odds returns
    //    live events with moving prices — refresh them so live betting odds
    //    track the market. Strictly odds-only via upsertInPlayOdds.
    let oddsUpdated = 0;
    const oddsWindowMs = Math.max(10, LIVE_ODDS_THROTTLE_SECONDS * 1000);
    if (Date.now() - lastOddsRefresh >= oddsWindowMs) {
      lastOddsRefresh = Date.now(); // backoff even on failure (quota-safe)
      try {
        const liveOdds = await provider.fetchUpcomingGames([...leagueKeys], LIVE_ODDS_MARKETS);
        oddsUpdated = (await upsertInPlayOdds(liveOdds)).updated;
      } catch (e) {
        console.error("[live-scores] in-play odds refresh failed:", e instanceof Error ? e.message : e);
      }
    }

    return { updated, created, oddsUpdated, skipped: false, leagues: [...leagueKeys] };
  } catch (e) {
    console.error("[live-scores] sweep failed:", e instanceof Error ? e.message : e);
    return { updated: 0, created: 0, oddsUpdated: 0, skipped: false, leagues: [] };
  }
}
