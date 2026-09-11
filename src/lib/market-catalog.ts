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
 * `settle` = how the outcome is decided (verified against src/lib/auto-settle.ts):
 *   "auto"    — resolved from the FINAL score the /scores feed provides
 *               (1X2 incl. 3-way, totals/goal lines, BTTS, DNB, DC, correct
 *               score, handicaps, team totals).
 *   "auto-ht" — resolver exists but needs the HALF-TIME score, which the feed
 *               does NOT provide; auto-settles only after an admin enters the
 *               HT score (Admin → Games). Otherwise it lands in the review queue.
 *   "manual"  — no resolver at all (corners, cards, half result/handicap/
 *               correct score, qualification, player props) → the outcome is
 *               left unsettled for an admin to mark Won/Lost/Void at
 *               Admin → Ops → Settlement Review.
 * Surfaced in the picker so operators see the settlement load up front.
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
  settle: "auto" | "auto-ht" | "manual";
};

export const MARKET_GROUPS: { id: MarketGroup; label: string; hint: string }[] = [
  { id: "core", label: "Core (cheap list pass)", hint: "h2h / handicap / totals — priced for every whitelisted league." },
  { id: "goals", label: "Goals & results (per event)", hint: "BTTS, Draw No Bet, Double Chance, Correct Score, team totals." },
  { id: "halves", label: "Halves (per event)", hint: "Half totals auto-settle once half-time scores are entered in Admin → Games; half results/handicaps need manual review." },
  { id: "corners", label: "Corners & cards (per event)", hint: "Pinnacle + Bovada serve these. Corners settle automatically once the statistics feed is enabled (API Settings); cards stay manual because booking conventions differ." },
  { id: "extras", label: "Extras (per event)", hint: "Half-time/full-time, knockout qualification." },
];

export const SOCCER_MARKETS: CatalogMarket[] = [
  // ── Core: list endpoint ────────────────────────────────────────────────
  { key: "h2h", name: "Match Result (1X2)", group: "core", listSupported: true, settle: "auto" },
  { key: "spreads", name: "Handicap", group: "core", listSupported: true, settle: "auto" },
  { key: "totals", name: "Over/Under", group: "core", listSupported: true, settle: "auto" },

  // ── Goals & results: per event ─────────────────────────────────────────
  { key: "btts", name: "Both Teams to Score", group: "goals", listSupported: false, settle: "auto" },
  { key: "draw_no_bet", name: "Draw No Bet", group: "goals", listSupported: false, settle: "auto" },
  { key: "double_chance", name: "Double Chance", group: "goals", listSupported: false, settle: "auto" },
  { key: "correct_score", name: "Correct Score", group: "goals", listSupported: false, settle: "auto" },
  { key: "h2h_3_way", name: "Match Result 3-way", group: "goals", listSupported: false, settle: "auto" },
  { key: "alternate_totals", name: "Goal Line (all totals)", group: "goals", listSupported: false, settle: "auto" },
  { key: "alternate_spreads", name: "Alternate Handicaps", group: "goals", listSupported: false, settle: "auto" },
  { key: "team_totals", name: "Team Totals", group: "goals", listSupported: false, settle: "auto" },
  { key: "alternate_team_totals", name: "Alternate Team Totals", group: "goals", listSupported: false, settle: "auto" },

  // ── Halves: per event ──────────────────────────────────────────────────
  { key: "h2h_h1", name: "1st Half Result", group: "halves", listSupported: false, settle: "manual" },
  { key: "h2h_h2", name: "2nd Half Result", group: "halves", listSupported: false, settle: "manual" },
  { key: "totals_h1", name: "1st Half Over/Under", group: "halves", listSupported: false, settle: "auto-ht" },
  { key: "totals_h2", name: "2nd Half Over/Under", group: "halves", listSupported: false, settle: "auto-ht" },
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
  { key: "btts_h1", name: "1st Half Both Teams to Score", group: "halves", listSupported: false, settle: "auto-ht" },
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
  { key: "halftime_fulltime", name: "Half Time / Full Time", group: "extras", listSupported: false, settle: "auto-ht" },
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
