import { getEffectiveOddsMarkets } from "@/lib/providers/odds-api";
import { estimateSyncCost, type SyncCostEstimate } from "@/lib/odds-cost-core";

// The pure model lives in odds-cost-core so client components can compute a
// draft selection's cost without dragging settings/prisma into the bundle.
export { LIST_MARKETS, estimateSyncCost, estimateDetailCost } from "@/lib/odds-cost-core";
export type { SyncCostEstimate } from "@/lib/odds-cost-core";

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
