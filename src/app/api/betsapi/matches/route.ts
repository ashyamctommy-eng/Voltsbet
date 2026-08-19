import { handle, ok } from "@/lib/api";
import { getBetsApiFeed } from "@/lib/betsapi-feed";

export type { BetsApiMatchView } from "@/lib/betsapi-feed";

/**
 * GET /api/betsapi/matches — upcoming fixtures transformed for the UI.
 *
 * Multi-endpoint sequence (executed SEQUENTIALLY, shared with the homepage):
 *   Step 1: /v1/bet365/upcoming?sport_id=1  → active fixture ids
 *   Step 2: /v3/bet365/prematch?FI={id}     → 1X2 / totals / handicap markets
 *
 * Returns transformed matches (MatchView) with merged markets. Rate-limit
 * failures on step 2 degrade to `markets: []` per match. In-process TTL cache
 * (BETSAPI_FEED_TTL_SECONDS, default 300) keeps page loads request-free.
 */
export const GET = handle(async () => {
  const matches = await getBetsApiFeed();
  return ok({ count: matches.length, matches });
});
