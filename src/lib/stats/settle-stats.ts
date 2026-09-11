/**
 * Stats-feed settlement pass — the money path.
 *
 * Runs inside the settlement cron (before the score-based sweep) and does two
 * things the score feed cannot:
 *
 *   1. HALF-TIME SCORES — writes `halfHomeScore/halfAwayScore` from the feed so
 *      the EXISTING resolvers settle 1H totals, 1H BTTS, HT/FT and highest
 *      scoring half (they already read those fields; no new logic, no guessing).
 *   2. CORNERS — resolves TOTAL_CORNERS / TEAM_CORNERS / CORNERS_1X2 /
 *      CORNERS_HANDICAP from per-team corner counts (see corner-settle.ts).
 *
 * Safety rules, in order of importance:
 *   • OFF unless the owner enables the provider AND the specific toggle.
 *   • Budget-guarded; a refusal skips — it never errors into the money path.
 *   • Only feed-confirmed finished matches (FT/AET/PEN) are touched.
 *   • Knockout finishes (AET/PEN) never settle 90-minute corner markets unless
 *     LIVE_ET_SETTLE=auto — same guard the score sweep uses.
 *   • Team orientation must be positively matched; ambiguous names are skipped.
 *   • Any resolution returning null leaves the outcome in the admin review queue.
 *
 * Cost model: ONE date-list call per matchday (cached, TTL), ONE statistics call
 * per finished match (cached forever — finished stats are immutable), and a
 * cached gameId→fixtureId map so the name matching happens once per game.
 */
import { prisma } from "@/lib/prisma";
import { settleOutcome } from "@/lib/settle";
import { getSettings } from "@/lib/settings";
import { isKnockoutFinishPeriod } from "@/lib/game-status";
import { ApiError } from "@/lib/api";
import { MARKET_MAP } from "@/lib/providers/odds-api";
import { SOCCER_MARKETS } from "@/lib/market-catalog";
import { fetchFixtureStats, fetchFixturesByDate, fetchMatchStatistics, resolveStatsKey, type StatsFixture } from "./api-football";
import { statsBudget } from "./budget";
import { keys as ck, isStale, readJson, readMany, writeJson, writeSetting } from "./store";
import { cornerScores, resolveCornerOutcome } from "./corner-settle";
import { matchFixture } from "./match";

const SYSTEM_ACTOR = { id: "system", username: "system" } as const;

/** Corner markets the stats feed can settle. Cards are deliberately excluded. */
export const CORNER_MARKET_KEYS = ["TOTAL_CORNERS", "TEAM_CORNERS", "CORNERS_1X2", "CORNERS_HANDICAP"] as const;

/** Local market keys whose resolver needs the HALF-TIME score (catalog `auto-ht`). */
export const HT_MARKET_KEYS: string[] = (() => {
  const locals = new Set<string>();
  for (const m of SOCCER_MARKETS) {
    if (m.settle !== "auto-ht") continue;
    const mapped = MARKET_MAP.find((x) => x.key === m.key);
    if (mapped) locals.add(mapped.local);
  }
  return [...locals];
})();

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export type StatsPassResult = {
  ran: boolean;
  reason?: string;
  candidates: number;
  matched: number;
  htFilled: number;
  statsFetched: number;
  settled: number;
  skipped: number;
  apiCalls: number;
  budget: { used: number; budget: number; remaining: number };
  notes: string[];
};

const empty = (budget: { used: number; budget: number; remaining: number }): StatsPassResult => ({
  ran: false,
  candidates: 0,
  matched: 0,
  htFilled: 0,
  statsFetched: 0,
  settled: 0,
  skipped: 0,
  apiCalls: 0,
  budget,
  notes: [],
});

export async function runStatsSettlement(opts: { force?: boolean } = {}): Promise<StatsPassResult> {
  const settings = await getSettings();
  const budget = await statsBudget();
  const out = empty(budget);

  // ── Gates ───────────────────────────────────────────────────
  if (settings.statsProvider !== "api-football") return { ...out, reason: "stats feed disabled" };
  if (!(await resolveStatsKey())) return { ...out, reason: "no API-Football key" };

  const cornersOn = settings.statsSettleCorners;
  const htOn = settings.statsSettleHalfTime;
  if (!cornersOn && !htOn) return { ...out, reason: "stats settlement toggles are off (collect-only)" };
  if (budget.remaining <= 0) return { ...out, reason: `daily budget spent (${budget.used}/${budget.budget})` };

  const throttleMs = num(process.env.STATS_PASS_THROTTLE_SECONDS, 600) * 1000;
  if (!opts.force) {
    const last = await readJson<{ at: number }>("stats.lastPassAt");
    const at = last.at ?? (last.value?.at ?? null);
    if (at && Date.now() - at < throttleMs) {
      return { ...out, reason: `throttled (last pass ${Math.round((Date.now() - at) / 1000)}s ago)` };
    }
  }

  out.ran = true; // past every gate — this pass really runs

  const maxGames = num(process.env.STATS_MAX_GAMES_PER_PASS, 12);
  const listTtl = num(process.env.STATS_LIST_TTL_SECONDS, 900);
  const cornerKeys = [...CORNER_MARKET_KEYS];

  // ── Candidates: finished games holding an UNRESOLVED market we can feed ──
  const orClauses: Record<string, unknown>[] = [];
  if (cornersOn) {
    orClauses.push({ markets: { some: { key: { in: cornerKeys }, outcomes: { some: { settled: false } } } } });
  }
  if (htOn) {
    orClauses.push({
      AND: [
        { OR: [{ halfHomeScore: null }, { halfAwayScore: null }] },
        { markets: { some: { key: { in: HT_MARKET_KEYS }, outcomes: { some: { settled: false } } } } },
      ],
    });
  }

  const games = await prisma.game.findMany({
    where: {
      status: "FINISHED",
      externalId: { not: null },
      startAt: { gte: new Date(Date.now() - 36 * 3600_000) },
      OR: orClauses,
    },
    include: {
      markets: { where: { key: { in: [...cornerKeys, ...HT_MARKET_KEYS] } }, include: { outcomes: { where: { settled: false } } } },
    },
    orderBy: { startAt: "asc" },
    take: maxGames,
  });
  out.candidates = games.length;
  if (!games.length) {
    await writeJson("stats.lastPassAt", { at: Date.now() });
    return { ...out, notes: ["no games needed the stats feed"] };
  }

  // ── Fixture lists (one call per matchday, cached) ────────────
  const dayCache = new Map<string, StatsFixture[] | null>();
  const loadDay = async (day: string): Promise<StatsFixture[] | null> => {
    if (dayCache.has(day)) return dayCache.get(day)!;
    const cached = await readJson<StatsFixture[]>(ck.list(day));
    if (cached.value && !isStale(cached.at, listTtl)) {
      dayCache.set(day, cached.value);
      return cached.value;
    }
    try {
      const fixtures = await fetchFixturesByDate(day);
      out.apiCalls++;
      await writeJson(ck.list(day), fixtures);
      dayCache.set(day, fixtures);
      return fixtures;
    } catch (e) {
      // Free plan: only today → +2 days. Past dates land here.
      const msg = e instanceof Error ? e.message : String(e);
      out.notes.push(`fixture list unavailable for ${day}: ${msg.slice(0, 120)}`);
      dayCache.set(day, null);
      return null;
    }
  };

  // ── Mappings already learned (one settings read for all games) ──
  const mapRows = await readMany(games.map((g) => ck.map(g.id)));

  for (const game of games) {
    const day = game.startAt.toISOString().slice(0, 10);
    const cachedId = mapRows.get(ck.map(game.id));
    let fixture: StatsFixture | null = null;

    if (cachedId) {
      // Reuse the mapping (and, if the matchday list is unavailable — e.g. the
      // game finished before the free plan's date window — ask by id).
      const list = await loadDay(day);
      fixture = (list ?? []).find((f) => String(f.fixtureId) === cachedId) ?? null;
      if (!fixture) {
        try {
          fixture = await fetchFixtureStats(cachedId);
          out.apiCalls++;
        } catch (e) {
          out.notes.push(`fixture ${cachedId} lookup failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
        }
      }
    } else {
      const list = (await loadDay(day)) ?? (await loadDay(nextDay(day))) ?? [];
      fixture = matchFixture(game, list);
      if (!fixture) {
        // Kickoff near midnight can land on the next provider date.
        const next = await loadDay(nextDay(day));
        if (next) fixture = matchFixture(game, next);
      }
      if (fixture) await writeSetting(ck.map(game.id), String(fixture.fixtureId));
    }

    if (!fixture) {
      out.skipped++;
      out.notes.push(`${game.homeName} vs ${game.awayName}: no fixture match`);
      continue;
    }
    if (!isFeedFinished(fixture.status)) {
      out.skipped++;
      out.notes.push(`${game.homeName} vs ${game.awayName}: feed says ${fixture.status}, not finished`);
      continue;
    }
    out.matched++;

    // ── 1) Half-time score → unlocks the existing auto-ht resolvers ──
    if (htOn && (game.halfHomeScore == null || game.halfAwayScore == null)) {
      if (fixture.halftime.home != null && fixture.halftime.away != null) {
        const res = await prisma.game.updateMany({
          where: { id: game.id, OR: [{ halfHomeScore: null }, { halfAwayScore: null }] },
          data: { halfHomeScore: fixture.halftime.home, halfAwayScore: fixture.halftime.away },
        });
        if (res.count > 0) {
          out.htFilled++;
          out.notes.push(`${game.homeName} vs ${game.awayName}: HT ${fixture.halftime.home}-${fixture.halftime.away} recorded`);
        }
      }
    }

    // ── 2) Corners ──────────────────────────────────────────────
    const cornerMarkets = game.markets.filter((m) => (CORNER_MARKET_KEYS as readonly string[]).includes(m.key) && m.outcomes.length > 0);
    if (!cornersOn || cornerMarkets.length === 0) continue;

    // 90-minute markets: an AET/PEN finish would settle them on the wrong corner count.
    const knockout = fixture.status === "AET" || fixture.status === "PEN" || isKnockoutFinishPeriod(game.period);
    if (knockout && process.env.LIVE_ET_SETTLE !== "auto") {
      out.skipped++;
      out.notes.push(`${game.homeName} vs ${game.awayName}: ${fixture.status} finish — corner markets left for review`);
      continue;
    }

    let stats = (await readJson<{ team: string; corners: number | null }[]>(ck.stats(fixture.fixtureId))).value;
    if (!stats) {
      try {
        stats = await fetchMatchStatistics(fixture.fixtureId);
        out.apiCalls++;
        if (stats.length) await writeJson(ck.stats(fixture.fixtureId), stats); // immutable once finished
      } catch (e) {
        out.notes.push(`statistics ${fixture.fixtureId} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
        out.skipped++;
        continue;
      }
    }
    if (!stats?.length) {
      out.skipped++;
      out.notes.push(`${game.homeName} vs ${game.awayName}: no statistics published yet`);
      continue;
    }

    const corners = cornerScores(stats, game);
    if (!corners) {
      out.skipped++;
      out.notes.push(`${game.homeName} vs ${game.awayName}: could not orient corner stats to home/away`);
      continue;
    }

    const scores = { ...corners, homeName: game.homeName, awayName: game.awayName };
    for (const market of cornerMarkets) {
      for (const outcome of market.outcomes) {
        const result = resolveCornerOutcome(scores, market.key, outcome.name, outcome.label);
        if (!result) {
          out.skipped++;
          continue; // undecidable → admin review
        }
        try {
          await settleOutcome(SYSTEM_ACTOR, outcome.id, result);
          out.settled++;
        } catch (e) {
          const isRace = e instanceof ApiError && e.code === "ALREADY_SETTLED";
          if (!isRace) {
            console.error(`[stats-settle] failed to settle outcome ${outcome.id} (${game.homeName} vs ${game.awayName} · ${market.name})`, e);
            out.skipped++;
          }
        }
      }
    }
  }

  out.budget = await statsBudget(); // refresh: the snapshot above predates this pass's own calls
  const summary = { at: Date.now(), ...out, notes: out.notes.slice(0, 40) };
  await writeJson("stats.lastPassAt", { at: Date.now() });
  await writeJson("stats.lastPass", summary);
  return out;
}

const nextDay = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Feed statuses that mean the match is over (90 minutes or beyond). */
export function isFeedFinished(status: string): boolean {
  return ["FT", "AET", "PEN", "PEN_FT"].includes(status);
}
