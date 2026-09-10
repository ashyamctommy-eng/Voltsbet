/**
 * Soccer market catalog — every valid market key for soccer from The Odds API
 * docs (https://the-odds-api.com/sports-odds-data/betting-markets.html,
 * retrieved 2026-09-10), grouped for the Admin picker.
 *
 * `listSupported` = served by the cheap /odds LIST endpoint (h2h, spreads,
 * totals). Everything else is ONLY available per event via
 * /events/{eventId}/odds ("Additional markets ... accessed one event at a
 * time"), which is why the per-event pass exists.
 *
 * `settle` = whether auto-settlement can resolve it from the /scores feed:
 *   "auto"   — full-time score/margin markets the settlement engine handles
 *   "manual" — needs data /scores does not expose (half-time scores, corners,
 *              cards, qualification, player props) → admin review queue
 * This is surfaced in the UI so operators know the settlement cost up front.
 *
 * Every key here MUST exist in the provider MARKET_MAP (provider → local key)
 * or the fetched prices can never be stored — enforced by a unit test.
 */
export type MarketGroup = "core" | "goals" | "halves" | "corners" | "extras";

export type CatalogMarket = {
  key: string;
  name: string;
  group: MarketGroup;
  listSupported: boolean;
  settle: "auto" | "manual";
};

export const MARKET_GROUPS: { id: MarketGroup; label: string; hint: string }[] = [
  { id: "core", label: "Core (cheap list pass)", hint: "h2h / handicap / totals — priced for every whitelisted league." },
  { id: "goals", label: "Goals & results (per event)", hint: "BTTS, Draw No Bet, Double Chance, Correct Score, team totals." },
  { id: "halves", label: "Halves (per event)", hint: "Half-time result/totals/handicap — half-time scores are not in /scores, so these settle manually." },
  { id: "corners", label: "Corners & cards (per event)", hint: "Pinnacle + Bovada serve these; no corner/card feed exists, so they settle manually." },
  { id: "extras", label: "Extras (per event)", hint: "Half-time/full-time, knockout qualification." },
];

export const SOCCER_MARKETS: CatalogMarket[] = [
  // ── Core: list endpoint ────────────────────────────────────────────────
  { key: "h2h", name: "Match Result (1X2)", group: "core", listSupported: true, settle: "auto" },
  { key: "spreads", name: "Handicap", group: "core", listSupported: true, settle: "manual" },
  { key: "totals", name: "Over/Under", group: "core", listSupported: true, settle: "auto" },

  // ── Goals & results: per event ─────────────────────────────────────────
  { key: "btts", name: "Both Teams to Score", group: "goals", listSupported: false, settle: "auto" },
  { key: "draw_no_bet", name: "Draw No Bet", group: "goals", listSupported: false, settle: "auto" },
  { key: "double_chance", name: "Double Chance", group: "goals", listSupported: false, settle: "auto" },
  { key: "correct_score", name: "Correct Score", group: "goals", listSupported: false, settle: "auto" },
  { key: "h2h_3_way", name: "Match Result 3-way", group: "goals", listSupported: false, settle: "auto" },
  { key: "alternate_totals", name: "Goal Line (all totals)", group: "goals", listSupported: false, settle: "auto" },
  { key: "alternate_spreads", name: "Alternate Handicaps", group: "goals", listSupported: false, settle: "manual" },
  { key: "team_totals", name: "Team Totals", group: "goals", listSupported: false, settle: "manual" },
  { key: "alternate_team_totals", name: "Alternate Team Totals", group: "goals", listSupported: false, settle: "manual" },

  // ── Halves: per event ──────────────────────────────────────────────────
  { key: "h2h_h1", name: "1st Half Result", group: "halves", listSupported: false, settle: "manual" },
  { key: "h2h_h2", name: "2nd Half Result", group: "halves", listSupported: false, settle: "manual" },
  { key: "totals_h1", name: "1st Half Over/Under", group: "halves", listSupported: false, settle: "manual" },
  { key: "totals_h2", name: "2nd Half Over/Under", group: "halves", listSupported: false, settle: "manual" },
  { key: "spreads_h1", name: "1st Half Handicap", group: "halves", listSupported: false, settle: "manual" },
  { key: "spreads_h2", name: "2nd Half Handicap", group: "halves", listSupported: false, settle: "manual" },
  { key: "alternate_totals_h1", name: "1st Half Goal Lines", group: "halves", listSupported: false, settle: "manual" },
  { key: "alternate_totals_h2", name: "2nd Half Goal Lines", group: "halves", listSupported: false, settle: "manual" },
  { key: "alternate_spreads_h1", name: "1st Half Alternate Handicaps", group: "halves", listSupported: false, settle: "manual" },
  { key: "alternate_spreads_h2", name: "2nd Half Alternate Handicaps", group: "halves", listSupported: false, settle: "manual" },
  { key: "team_totals_h1", name: "1st Half Team Totals", group: "halves", listSupported: false, settle: "manual" },
  { key: "team_totals_h2", name: "2nd Half Team Totals", group: "halves", listSupported: false, settle: "manual" },
  { key: "alternate_team_totals_h1", name: "1st Half Alt Team Totals", group: "halves", listSupported: false, settle: "manual" },
  { key: "alternate_team_totals_h2", name: "2nd Half Alt Team Totals", group: "halves", listSupported: false, settle: "manual" },
  { key: "btts_h1", name: "1st Half Both Teams to Score", group: "halves", listSupported: false, settle: "manual" },
  { key: "double_chance_h1", name: "1st Half Double Chance", group: "halves", listSupported: false, settle: "manual" },
  { key: "correct_score_h1", name: "1st Half Correct Score", group: "halves", listSupported: false, settle: "manual" },

  // ── Corners & cards: per event (the markets that were missing) ─────────
  { key: "alternate_totals_corners", name: "Total Corners (Over/Under)", group: "corners", listSupported: false, settle: "manual" },
  { key: "alternate_spreads_corners", name: "Handicap Corners", group: "corners", listSupported: false, settle: "manual" },
  { key: "alternate_team_totals_corners", name: "Team Total Corners", group: "corners", listSupported: false, settle: "manual" },
  { key: "corners_1x2", name: "Corners 1X2 (most corners)", group: "corners", listSupported: false, settle: "manual" },
  { key: "alternate_totals_cards", name: "Total Cards / Bookings (O/U)", group: "corners", listSupported: false, settle: "manual" },
  { key: "alternate_spreads_cards", name: "Handicap Cards / Bookings", group: "corners", listSupported: false, settle: "manual" },

  // ── Extras: per event ──────────────────────────────────────────────────
  { key: "halftime_fulltime", name: "Half Time / Full Time", group: "extras", listSupported: false, settle: "auto" },
  { key: "to_qualify", name: "Team to Qualify (knockout)", group: "extras", listSupported: false, settle: "manual" },
];

/** Default bulk sweep (Tier 1) — recommended in the admin panel. */
export const RECOMMENDED_BULK_MARKETS = ["h2h", "btts", "draw_no_bet", "totals"];

/** Default deep menu (Tier 2) — includes corners so they appear on match detail. */
export const RECOMMENDED_DETAIL_MARKETS = [
  "alternate_totals",
  "alternate_spreads",
  "h2h_h1",
  "h2h_h2",
  "team_totals",
  "corners_1x2",
  "alternate_totals_corners",
  "alternate_spreads_corners",
  "alternate_team_totals_corners",
];

export function marketsByKey(): Map<string, CatalogMarket> {
  return new Map(SOCCER_MARKETS.map((m) => [m.key, m]));
}
