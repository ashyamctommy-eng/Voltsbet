/**
 * Stat-based outcome resolvers — the markets the goal-based `resolveOutcome`
 * (src/lib/auto-settle.ts) cannot do, because they depend on per-team CORNERS
 * and CARDS rather than goals.
 *
 *   Total Corners      Over/Under on both teams' corners (push → VOID)
 *   Team Corners       Over/Under on ONE team's corners (name carries the team)
 *   Corners 1X2        Most corners (Draw resolves as Draw)
 *   Corners Handicap   Corner handicap (quarter lines split; mixed → null)
 *   Total Bookings     Over/Under on bookings POINTS (see CARD_CONVENTION)
 *   Cards Handicap     Handicap on bookings points
 *
 * `null` means "cannot decide" and the outcome is left for the admin review
 * queue — this module NEVER guesses. That is the money-safety rule: a wrong
 * WON pays a customer who did not win, and a wrong LOST keeps money that is
 * not ours.
 *
 * Pure functions, no DB access — unit-tested in
 * src/lib/__tests__/settlement-resolve.test.ts.
 */

export type StatResult = "WON" | "LOST" | "VOID" | null;

/** Per-team counts for one half or the full match. */
export type SideCounts = { home: number | null; away: number | null };

export type CardCounts = {
  homeYellows: number | null;
  awayYellows: number | null;
  homeReds: number | null;
  awayReds: number | null;
};

export type StatContext = {
  homeName: string;
  awayName: string;
  corners: { ht: SideCounts; ft: SideCounts };
  cards: { ht: CardCounts; ft: CardCounts };
};

/** Market keys this module owns. */
export const CORNER_MARKET_KEYS = new Set([
  "TOTAL_CORNERS",
  "TEAM_CORNERS",
  "CORNERS_1X2",
  "CORNERS_HANDICAP",
]);
export const CARD_MARKET_KEYS = new Set(["TOTAL_BOOKINGS", "CARDS_HANDICAP"]);

/**
 * Markets that cannot be settled from the full-time score alone: they need the
 * HALF-TIME goals (the `settle: "auto-ht"` family in the market catalog). They
 * are not resolved by this module - the existing resolveOutcome() handles them -
 * but they are listed here so the work list knows they still need a scrape.
 */
export const HALF_TIME_MARKET_KEYS = new Set([
  "OVER_UNDER_1H",
  "OVER_UNDER_2H",
  "FIRST_HALF_BTTS",
  "HT_FT",
  "HT_RESULT",
  "HALF_TIME_RESULT",
]);

/**
 * Every market key that depends on data only an external source has (corners,
 * cards, or the half-time split). This is the filter for the settlement work
 * list: a game with none of these has no reason to be scraped.
 */
export const STAT_DEPENDENT_MARKET_KEYS = new Set<string>([
  ...CORNER_MARKET_KEYS,
  ...CARD_MARKET_KEYS,
  ...HALF_TIME_MARKET_KEYS,
]);

/**
 * Booking-points convention: **yellow = 1, red = 2** (a straight red is worth
 * a yellow more than a booking, which is the standard football-betting
 * reading of "Total Bookings"). Providers differ — some count each card as 1,
 * some use 10/25 points. That is exactly why card settlement ships DISABLED:
 * card markets only resolve when SETTLEMENT_SETTLE_CARDS is explicitly turned
 * on, after the operator has verified the convention against real matches.
 */
export const BOOKING_POINTS = { yellow: 1, red: 2 } as const;

function lineFrom(name: string): number | null {
  const m = name.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

const isQuarter = (line: number) => Math.abs(line % 1) === 0.25 || Math.abs(line % 1) === 0.75;

/** Over/Under on a value. Whole-line push → VOID; quarter lines → null (Asian split can't be modelled). */
function overUnder(value: number, line: number, isOver: boolean, isUnder: boolean): StatResult {
  if (!isOver && !isUnder) return null;
  if (isQuarter(line)) return null;
  if (value === line) return "VOID";
  if (isOver) return value > line ? "WON" : "LOST";
  return value < line ? "WON" : "LOST";
}

/** Which side does this outcome refer to? 1 = home, 2 = away, 0 = neither/ambiguous. */
function side(outcomeName: string, label: string | null, g: StatContext): 1 | 2 | 0 {
  const n = normalizeTeamName(outcomeName);
  const home = normalizeTeamName(g.homeName);
  const away = normalizeTeamName(g.awayName);
  const hits = (team: string) => {
    if (!team) return false;
    const first = team.split(" ")[0];
    return n.includes(team) || (first.length >= 4 && n.includes(first));
  };
  const homeHit = hits(home);
  const awayHit = hits(away);
  if (homeHit && !awayHit) return 1;
  if (awayHit && !homeHit) return 2;
  if (homeHit && awayHit) return 0; // shared token → ambiguous → admin
  if (label === "1" || label === "home") return 1;
  if (label === "2" || label === "away") return 2;
  return 0;
}

/** Handicap on a value; quarter lines split into two half-stakes (mixed → null). */
function handicapResult(
  value: number,
  opp: number,
  handicap: number,
): StatResult {
  const single = (h: number): StatResult => {
    const adj = value + h;
    if (adj === opp) return "VOID";
    return adj > opp ? "WON" : "LOST";
  };
  if (isQuarter(handicap)) {
    const lower = handicap - Math.sign(handicap) * 0.25;
    const upper = handicap + Math.sign(handicap) * 0.25;
    const a = single(lower);
    const b = single(upper);
    return a === b ? a : null;
  }
  return single(handicap);
}

/**
 * True when the market key asks for HALF-TIME corners. No half-corner board
 * ships today (the provider family is full-match only) — the branch exists so
 * a future `*_1H` board settles off the HT counts the worker already sends,
 * rather than silently resolving against full-time numbers.
 */
const isHalfTimeKey = (marketKey: string) => /(_1H|_HT|_H1)$/.test(marketKey);

function totalCards(cards: CardCounts): number | null {
  const { homeYellows, awayYellows, homeReds, awayReds } = cards;
  if (homeYellows == null || awayYellows == null || homeReds == null || awayReds == null) return null;
  const points = (y: number, r: number) => y * BOOKING_POINTS.yellow + r * BOOKING_POINTS.red;
  return points(homeYellows, homeReds) + points(awayYellows, awayReds);
}

/** Home/away card points, for the handicap family. */
function cardPoints(cards: CardCounts): { home: number; away: number } | null {
  const { homeYellows, awayYellows, homeReds, awayReds } = cards;
  if (homeYellows == null || awayYellows == null || homeReds == null || awayReds == null) return null;
  return {
    home: homeYellows * BOOKING_POINTS.yellow + homeReds * BOOKING_POINTS.red,
    away: awayYellows * BOOKING_POINTS.yellow + awayReds * BOOKING_POINTS.red,
  };
}

/**
 * Resolve one outcome of a corner or card market. Returns null for anything
 * this module doesn't own (goal markets are handled by resolveOutcome) or
 * anything it cannot decide safely.
 */
export function resolveStatOutcome(
  g: StatContext,
  marketKey: string,
  outcomeName: string,
  outcomeLabel: string | null,
  opts?: { settleCards?: boolean },
): StatResult {
  const name = outcomeName.toLowerCase().trim();
  const label = (outcomeLabel ?? "").toLowerCase();
  const halfTime = isHalfTimeKey(marketKey);
  const corners = halfTime ? g.corners.ht : g.corners.ft;

  // ── Total corners Over/Under ────────────────────────────────
  if (marketKey === "TOTAL_CORNERS") {
    const total = corners.home != null && corners.away != null ? corners.home + corners.away : null;
    if (total == null) return null;
    const line = lineFrom(name);
    if (line == null) return null;
    return overUnder(total, line, name.startsWith("over"), name.startsWith("under"));
  }

  // ── One team's corners Over/Under ("Arsenal Over 4.5") ──────
  if (marketKey === "TEAM_CORNERS") {
    const s = side(outcomeName, label, g);
    if (s === 0) return null;
    const value = s === 1 ? corners.home : corners.away;
    if (value == null) return null;
    const line = lineFrom(name);
    if (line == null) return null;
    return overUnder(value, line, /\bover\b/.test(name), /\bunder\b/.test(name));
  }

  // ── Most corners (1X2) ─────────────────────────────────────
  if (marketKey === "CORNERS_1X2") {
    if (corners.home == null || corners.away == null) return null;
    const isDraw = label === "x" || name === "draw" || name === "tie";
    const s = side(outcomeName, label, g);
    if (!isDraw && s === 0) return null;
    const diff = corners.home - corners.away;
    if (isDraw) return diff === 0 ? "WON" : "LOST";
    if (s === 1) return diff > 0 ? "WON" : "LOST";
    return diff < 0 ? "WON" : "LOST";
  }

  // ── Corner handicap ("Home -1.5" / "Arsenal -2") ────────────
  if (marketKey === "CORNERS_HANDICAP") {
    if (corners.home == null || corners.away == null) return null;
    const m = name.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const handicap = Number(m[1]);
    if (!Number.isFinite(handicap)) return null;
    const backed = m[0].trim().length === name.trim().length ? 0 : side(outcomeName, label, g);
    if (backed === 0) return null;
    const value = backed === 1 ? corners.home : corners.away;
    const opp = backed === 1 ? corners.away : corners.home;
    return handicapResult(value, opp, handicap);
  }

  // ── Cards (opt-in; see BOOKING_POINTS) ──────────────────────
  if (CARD_MARKET_KEYS.has(marketKey)) {
    if (!opts?.settleCards) return null;
    const cards = halfTime ? g.cards.ht : g.cards.ft;

    if (marketKey === "TOTAL_BOOKINGS") {
      const total = totalCards(cards);
      if (total == null) return null;
      const line = lineFrom(name);
      if (line == null) return null;
      return overUnder(total, line, name.startsWith("over"), name.startsWith("under"));
    }

    // CARDS_HANDICAP
    const pts = cardPoints(cards);
    if (!pts) return null;
    const m = name.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const handicap = Number(m[1]);
    if (!Number.isFinite(handicap)) return null;
    const backed = m[0].trim().length === name.trim().length ? 0 : side(outcomeName, label, g);
    if (backed === 0) return null;
    const value = backed === 1 ? pts.home : pts.away;
    const opp = backed === 1 ? pts.away : pts.home;
    return handicapResult(value, opp, handicap);
  }

  return null; // goal markets / unknown keys → not ours
}

/**
 * Normalize a team name for matching: strip accents, punctuation, case and the
 * club-suffix noise ("FC", "AFC", "CF" …) that differs between the fixture
 * feed and a scraper.
 */
export function normalizeTeamName(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|afc|cf|sc|ac|as|ss|ssc|cd|ud|rc|rcd|bk|fk|if|club|the|de|of)\b/g, " ")
    .split(" ")
    .filter((t) => t.length > 1) // initials left over from "S.A.D." are noise
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
