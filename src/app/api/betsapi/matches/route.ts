import { handle, ok } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { BetsApiClient } from "@/lib/providers/betsapi-client";
import {
  RawBetsApiMatch,
  PrematchLike,
  MatchView,
  transformBetsApiMatch,
  extractOddsMarkets,
  ViewMarket,
} from "@/lib/providers/betsapi-transformer";

const ODDS_LIMIT = 10; // prematch is 1 request per event — keep the proxy modest

export type BetsApiMatchView = MatchView & { markets: ViewMarket[] };

/**
 * GET /api/betsapi/matches — upcoming fixtures transformed for the UI.
 *
 * Multi-endpoint sequence (executed SEQUENTIALLY per spec):
 *   Step 1: /v1/bet365/upcoming?sport_id=1  → active fixture ids
 *   Step 2: /v3/bet365/prematch?FI={id}     → 1X2 / totals / handicap markets
 *
 * Returns transformed matches (MatchView) with merged markets. Rate-limit
 * failures on step 2 degrade to `markets: []` per match.
 */
export const GET = handle(async () => {
  const client = await BetsApiClient.fromSettings();
  const margin = (await getSettings()).oddsMarginPercent;

  // Step 1 — fixture list (metadata only)
  const up = await client.getUpcomingEvents(1);
  const events = ((up.results ?? []) as RawBetsApiMatch[]).filter(
    (e) => String(e.time_status) === "0", // pre-match only
  );

  // Step 2 — prematch odds per fixture, sequential (1 request each)
  const matches: BetsApiMatchView[] = [];
  for (const ev of events.slice(0, ODDS_LIMIT)) {
    const homeTeam = ev.home?.name ?? "Home";
    const awayTeam = ev.away?.name ?? "Away";
    let markets: ViewMarket[] = [];
    try {
      const pm = await client.getPrematchOdds(String(ev.id));
      const first = ((pm.results ?? []) as PrematchLike[])[0] ?? null;
      markets = extractOddsMarkets(first, homeTeam, awayTeam, margin);
    } catch {
      /* odds optional — match still returned, markets: [] */
    }
    matches.push({ ...transformBetsApiMatch(ev), markets });
  }

  return ok({ count: matches.length, matches });
});
