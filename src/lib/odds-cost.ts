import { LIST_MARKETS, getEffectiveOddsMarkets } from "@/lib/providers/odds-api";

/**
 * Odds-sync credit cost model.
 *
 * The Odds API bills per REQUEST, and a request's cost is
 * `markets × regions`. The horizon is free: `/sports/{key}/odds` returns every
 * upcoming event for that league in one request, so a 7-day window costs the
 * same as a 1-day one, and re-fetching overlapping fixtures costs nothing.
 *
 * Two passes run on a sync:
 *   • list pass  — 1 request per league, `listMarkets × regions` credits each
 *   • event pass — 1 request per FEATURED EVENT, `extendedMarkets × regions`
 *                  each (the deep markets: btts, corners, correct score…)
 *
 *   credits ≈ leagues × listMarkets × regions
 *           + eventLeagues × eventLimit × extendedMarkets × regions
 *
 * The event pass is usually the dominant term and is INDEPENDENT of how many
 * leagues you sync — that is why trimming leagues barely moves the bill while
 * trimming the extended market menu moves it a lot.
 */

export type SyncCostEstimate = {
  leagues: number;
  listMarkets: number;
  regions: number;
  eventLeagues: number;
  eventLimit: number;
  extendedMarkets: number;
  /** Upper bound on deep-pass requests (leagues × limit). */
  maxEvents: number;
  listCredits: number;
  eventCredits: number;
  totalCredits: number;
  /** Rough monthly projection at a given runs/day. */
  monthlyAt: (runsPerDay: number) => number;
};

function countRegions(regions: string): number {
  const n = regions
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean).length;
  return Math.max(1, n);
}

/** Pure estimate — pass the already-resolved market list. */
export function estimateSyncCost(input: {
  leagues: number;
  markets: readonly string[];
  regions: string;
  eventLeagues: number;
  eventLimit: number;
}): SyncCostEstimate {
  const listMarkets = input.markets.filter((m) =>
    (LIST_MARKETS as readonly string[]).includes(m)
  ).length;
  // Every non-list market is charged on the per-event pass.
  const extendedMarkets = Math.max(0, input.markets.length - listMarkets);
  const regions = countRegions(input.regions);
  const leagues = Math.max(0, Math.round(input.leagues));
  const eventLeagues = Math.max(0, Math.round(input.eventLeagues));
  const eventLimit = Math.max(0, Math.round(input.eventLimit));

  const maxEvents = eventLeagues * eventLimit;
  const listCredits = leagues * listMarkets * regions;
  const eventCredits = maxEvents * extendedMarkets * regions;
  const totalCredits = listCredits + eventCredits;

  return {
    leagues,
    listMarkets,
    regions,
    eventLeagues,
    eventLimit,
    extendedMarkets,
    maxEvents,
    listCredits,
    eventCredits,
    totalCredits,
    monthlyAt: (runsPerDay: number) => Math.round(totalCredits * runsPerDay * 30),
  };
}

/** Resolve the effective market set (env → DB → default) and estimate. */
export async function estimateSyncCostWithMarkets(input: {
  leagues: number;
  regions: string;
  eventLeagues: number;
  eventLimit: number;
}): Promise<SyncCostEstimate> {
  const markets = await getEffectiveOddsMarkets();
  return estimateSyncCost({ ...input, markets });
}
