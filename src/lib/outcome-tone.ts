/**
 * Global outcome color tokens — semantic side colors for TWO-OUTCOME markets
 * only (Goal Line / Over & Under, BTTS Yes/No, Asian Handicaps, DNB, team
 * totals). 3+-outcome boards (1X2, double chance, correct score, HT/FT …)
 * are deliberately NOT colored — callers gate with isTwoWayMarket().
 *
 * Product mapping (two-var boards, column convention):
 *   Column 1 / option A — Over · Home · Team 1 · Yes   → emerald
 *   Column 2 / option B — Under · Away · Team 2 · No    → sky
 *
 * Returns null (neutral → caller keeps its brand default) when the outcome
 * has no competing side or the board is not a two-variable market.
 *
 * Class literals live verbatim here so Tailwind v4's scanner picks them up.
 */
export type OutcomeSide = "first" | "second" | "draw";

export const SIDE_TEXT_CLASS: Record<OutcomeSide, string> = {
  first: "text-emerald-400",
  second: "text-sky-400",
  draw: "text-amber-400",
};

export function sideTextClass(side: OutcomeSide | null | undefined): string | null {
  return side ? SIDE_TEXT_CLASS[side] : null;
}

/**
 * Resolve an outcome's side from its label/name against the fixture's team
 * names. Priority: label ("1"/"X"/"2") → HT/FT leg → correct-score diff →
 * double chance → Yes/No → Odd/Even → Draw → Over/Under (anywhere in the
 * name, so team-totals like "Arsenal Over 1.5" color by line) → team match.
 */
export function outcomeSide(o: {
  label?: string | null;
  name?: string | null;
  home?: string | null;
  away?: string | null;
}): OutcomeSide | null {
  const label = (o.label ?? "").trim().toLowerCase();
  if (label === "1" || label === "h" || label === "home") return "first";
  if (label === "2" || label === "a" || label === "away") return "second";
  if (label === "x" || label === "draw") return "draw";

  const name = (o.name ?? "").trim().toLowerCase();
  if (!name) return null;

  // HT/FT ("1/X", "2/1", "X/X") — color by the first-half leg.
  const htft = name.match(/^([12x])\s*\//);
  if (htft) return htft[1] === "1" ? "first" : htft[1] === "2" ? "second" : "draw";

  // Correct score "2-1" (home score first) — color by who wins.
  const cs = name.match(/^(\d{1,2})-(\d{1,2})$/);
  if (cs) {
    const h = Number(cs[1]);
    const a = Number(cs[2]);
    return h > a ? "first" : a > h ? "second" : "draw";
  }

  // Double chance ("1X" = home or draw, "X2" = away or draw, "12" = either).
  if (name === "1x" || name === "x1") return "first";
  if (name === "x2" || name === "2x") return "second";
  if (name === "12") return "draw";

  // BTTS / parity / simple booleans.
  if (name === "yes" || name === "true") return "first";
  if (name === "no" || name === "false") return "second";
  if (name === "odd") return "first"; // odd/even total goals
  if (name === "even") return "second";
  if (/^(draw|tie|x)$/.test(name)) return "draw";

  // Totals / team totals — column convention: "Over …" is column 1 (emerald),
  // "Under …" column 2 (sky) — incl. team totals like "Arsenal Over 1.5".
  if (/\bover\b/.test(name)) return "first";
  if (/\bunder\b/.test(name)) return "second";

  // Team sides — compare to the fixture's participants (guard short tokens).
  const home = (o.home ?? "").trim().toLowerCase();
  const away = (o.away ?? "").trim().toLowerCase();
  if (home && home.length >= 3 && name.startsWith(home)) return "first";
  if (away && away.length >= 3 && name.startsWith(away)) return "second";
  return null;
}

/**
 * Boards that are NOT two-variable (3-way or multi-way): never color-coded.
 * Correct score, player props and ranges are additionally caught by shape.
 */
const MULTIWAY_KEYS = new Set([
  "MATCH_RESULT", "h2h",
  "HT_RESULT", "HALF_TIME_RESULT", "h2h_h1", "h2h_h2",
  "DOUBLE_CHANCE", "DOUBLE_CHANCE_H1",
  "EUROPEAN_HANDICAP", "HT_FT", "HIGHEST_SCORING_HALF", "CORNERS_1X2",
  "CORRECT_SCORE", "correct_score", "CORRECT_SCORE_H1",
  "MULTI_GOALS", "GOAL_PARITY_MIXED", "3WAY", "1X2",
  "PLAYER_GOALSCORER_ANYTIME", "PLAYER_FIRST_GOALSCORER",
  "PLAYER_LAST_GOALSCORER", "PLAYER_RECEIVE_CARD",
  "PLAYER_RECEIVE_RED_CARD", "PLAYER_SHOTS_ON_TARGET", "PLAYER_SHOTS",
  "PLAYER_ASSISTS",
]);

/**
 * True when a market is a two-variable (binary) board eligible for the
 * emerald/sky side colors: every outcome is an Over/Under line (Goal Line,
 * alternate totals, corners/cards totals, team totals), a Yes/No pair (BTTS,
 * win-to-nil), or exactly two options (DNB, Asian handicap, parity).
 * 3+-outcome markets — 1X2, double chance, correct score, HT/FT, player
 * props, goal ranges — return false and keep the neutral brand styling.
 */
export function isTwoWayMarket(marketKey: string, names: readonly string[]): boolean {
  if (MULTIWAY_KEYS.has(marketKey)) return false;
  const n = names.length;
  if (n < 2) return false;
  // Goal Line / totals / team totals — every outcome is an Over/Under line.
  if (names.every((nm) => /\bover\b/i.test(nm) || /\bunder\b/i.test(nm))) return true;
  // BTTS / simple Yes-No boards.
  if (names.every((nm) => /^(yes|no)$/i.test(nm.trim()))) return true;
  // Clean two-way board (DNB, Asian single line, parity, 2-way specials).
  if (n === 2) return true;
  return false;
}
