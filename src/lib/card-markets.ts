/**
 * The market set the FEED CARDS actually render.
 *
 * A card needs (a) the main market it displays, (b) any market the header-level
 * market filter can select, and (c) a COUNT of all bettable markets for the
 * "+N Markets" badge — it does NOT need the full derived board.
 *
 * Hydrating + serializing the whole board for every fixture was the single
 * biggest performance and memory defect in the app. Measured 2026-10-07 on
 * production: /sports/football shipped **19.7 MB** of HTML, hydrating 643
 * fixtures x 21.4 markets x 115 outcomes (73,936 outcomes), and a SINGLE
 * request pushed the Node process RSS from 708 MB to 1,167 MB (+432 MB), which
 * is what drove the PM2 memory-restart loop.
 *
 * Restricting the relation to these 7 keys keeps 9,840 of 73,936 outcomes
 * (a 7.5x cut) with ZERO football fixtures losing every market, so no card
 * regresses to "Market Suspended". The full menu still lives on /match/[id].
 *
 * Keep this list in step with MARKET_FILTERS in components/MatchFeed.tsx.
 */
export const CARD_MARKET_KEYS = [
  "MATCH_RESULT", // 1x2 / Winner — the card's default main market
  "DRAW_NO_BET",
  "DOUBLE_CHANCE",
  "BTTS",
  "HT_RESULT",
  "OVER_UNDER", // fallback main market for fixtures with no 1x2
  "SPREAD",
] as const;
