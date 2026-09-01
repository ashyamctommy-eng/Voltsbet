/**
 * Market display helpers — terminology standardization + handicap point
 * parsing/formatting. Pure functions (client-safe).
 *
 * Terminology: the UI speaks "Handicap" (European betting convention), but
 * older data + provider names say "Spread". standardizeMarketName() maps
 * legacy DB names to the canonical labels at render time, so existing rows
 * display correctly without a data migration.
 *
 * Handicap points: the Outcome model has no `point` column — the line lives
 * inside the outcome NAME ("Barcelona -1.5", "Rayo Vallecano +1.5").
 * parseOutcomePoint() extracts it and formatOutcomeName() renders the clean
 * `${team} (±point)` shape.
 */

/** Market keys that carry a handicap line in their outcome names. */
export const HANDICAP_MARKET_KEYS = new Set([
  "SPREAD",
  "spreads",
  "ALTERNATE_SPREAD",
  "alternate_spreads",
  "SPREAD_1H",
  "spreads_h1",
  "SPREAD_2H",
  "spreads_h2",
  "HANDICAP",
  "ASIAN_HANDICAP",
  "asian_handicap",
  "CORNERS_HANDICAP",
  "CARDS_HANDICAP",
]);

/** Legacy DB/provider names → canonical UI terminology. */
const LEGACY_MARKET_NAMES: Record<string, string> = {
  Spread: "Handicap",
  "Alternate Spreads": "Alternate Handicaps",
  "1st Half - Spread": "1st Half Handicap",
  "2nd Half - Spread": "2nd Half Handicap",
};

/** Standardize a market category name for display (legacy aliases → canon). */
export function standardizeMarketName(name: string): string {
  return LEGACY_MARKET_NAMES[name] ?? name;
}

export type OutcomePoint = { team: string; point: number | null; raw?: string | null };

/**
 * Split an outcome name into team + handicap line. Handles both shapes:
 *   "Barcelona -1.5" | "Barcelona (-1.5)" | "Home +0.5" → { team, point: -1.5 }
 *   "Over 2.5", "2-1", "Arsenal"                            → { team, point: null }
 * A signed number is only recognized when separated from the team text by
 * whitespace (so correct scores like "2-1" are never misparsed).
 */
export function parseOutcomePoint(name: string): OutcomePoint {
  const paren = /^(.*?)\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*\)\s*$/.exec(name);
  if (paren) {
    return { team: paren[1].trim(), point: Number(paren[2]), raw: paren[2] };
  }
  const bare = /^(.*?)\s+([-+]?\d+(?:\.\d+)?)\s*$/.exec(name);
  if (bare) {
    return { team: bare[1].trim(), point: Number(bare[2]), raw: bare[2] };
  }
  return { team: name.trim(), point: null, raw: null };
}

/**
 * Render an outcome name for handicap-family markets in the clean
 * `${team} (±point)` shape. Non-handicap markets (totals, correct score,
 * 1X2…) pass through untouched.
 */
export function formatOutcomeName(name: string, marketKey: string): string {
  if (!HANDICAP_MARKET_KEYS.has(marketKey)) return name;
  const { team, point, raw } = parseOutcomePoint(name);
  if (point === null || !team) return name;
  // Preserve the raw line text ("0.0", "-1.5", "+1.5") — Number() would
  // drop the trailing ".0" on whole lines.
  const line = raw ?? (point > 0 ? `+${point}` : `${point}`);
  return `${team} (${line})`;
}

export type HandicapPair = {
  line: number;
  home?: { id: string; name: string; label?: string | null };
  away?: { id: string; name: string; label?: string | null };
};

/**
 * Group handicap outcomes into paired (home, away) rows per line — the
 * "Home (-1.5) [odds]  |  Away (+1.5) [odds]" layout. Teams are resolved by
 * matching the outcome name against the fixture's team names, the label
 * (1/2, home/away), or a Home/Away prefix. Unpaired leftovers return as
 * singleton rows.
 */
export function groupHandicapPairs(
  outcomes: { id: string; name: string; label?: string | null }[],
  homeName: string,
  awayName: string,
): HandicapPair[] {
  const homeL = homeName.toLowerCase();
  const awayL = awayName.toLowerCase();
  const rows = new Map<number, HandicapPair>();

  for (const o of outcomes) {
    const { team, point } = parseOutcomePoint(o.name);
    if (point === null) continue; // not a handicap line — leave to default layout
    const t = team.toLowerCase();
    const label = (o.label ?? "").toLowerCase();
    const isHome =
      t === homeL || label === "1" || label === "home" || t.startsWith("home") || (homeL && t.includes(homeL));
    const isAway =
      t === awayL || label === "2" || label === "away" || t.startsWith("away") || (awayL && t.includes(awayL));
    if (!isHome && !isAway) continue;

    const line = Math.abs(point); // Home −1.5 / Away +1.5 are the same line
    const row = rows.get(line) ?? { line };
    if (isHome) row.home = { id: o.id, name: o.name, label: o.label };
    else row.away = { id: o.id, name: o.name, label: o.label };
    rows.set(line, row);
  }

  return [...rows.values()].sort((a, b) => a.line - b.line); // -2.5 → +2.5
}
