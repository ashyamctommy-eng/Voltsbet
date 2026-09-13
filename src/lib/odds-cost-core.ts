/**
 * Odds-sync credit cost model — CLIENT-SAFE core.
 *
 * Deliberately dependency-free (no settings, no prisma) so admin UI can compute
 * the cost of an UNSAVED market selection live, while the server keeps using the
 * same function via lib/odds-cost. One formula, two callers, no drift.
 *
 * The Odds API bills per REQUEST, and a request costs `markets × regions`.
 * The horizon is free: `/sports/{key}/odds` returns every upcoming event for a
 * league in one request, so a 7-day window costs the same as a 1-day one.
 *
 *   list pass  — 1 request per league,  `listMarkets × regions`
 *   event pass — 1 request per EVENT,   `extendedMarkets × regions`
 *
 *   credits = leagues × listMarkets × regions
 *           + eventLeagues × eventLimit × extendedMarkets × regions
 *
 * The event pass is usually dominant — which is why trimming leagues barely
 * moves the bill while trimming the extended menu moves it a lot.
 */

/** Markets the bulk `/odds` list pass actually serves (the cheap three). */
export const LIST_MARKETS = ["h2h", "spreads", "totals"] as const;

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

/**
 * Form fields arrive as strings and blanks become NaN. Coerce once, here, so a
 * half-typed input renders 0 rather than "NaN credits per sync run".
 */
function safeInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

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
  const leagues = safeInt(input.leagues);
  const eventLeagues = safeInt(input.eventLeagues);
  const eventLimit = safeInt(input.eventLimit);

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

/**
 * Tier 2 (match-detail deep markets) is NOT part of a sync run: the provider
 * charges `markets × regions` on the request fired when a customer opens a
 * match, and the cache TTL is what stops repeat views paying again. Modelled
 * separately so the UI never folds a per-view cost into a per-run number.
 */
export function estimateDetailCost(input: {
  markets: readonly string[];
  regions: string;
}): { markets: number; regions: number; perView: number } {
  const regions = countRegions(input.regions);
  // Trim first: a whitespace-only entry from a CSV form field is not a market.
  const markets = input.markets.map((m) => m.trim()).filter(Boolean).length;
  return { markets, regions, perView: markets * regions };
}
