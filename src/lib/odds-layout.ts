/**
 * Odds layout — the ONE place that decides how a market's outcomes are laid
 * out on screen, shared by the home/live feed cards (MatchCard) and the match
 * detail board (FixtureMarkets) so every surface renders identically.
 *
 * Rule (matches the design reference):
 *   - Over/Under line markets pair 2-up per line, ascending —
 *       Over 2.5 [2.29] | Under 2.5 [1.66]
 *   - every other board stacks full-width, one outcome per row —
 *       1X2, Double Chance, Draw No Bet, BTTS, "who will win", 1st goal …
 *
 * The pairing is decided by the OUTCOME NAME SHAPE ("Over 2.5" / "Under 2.5",
 * incl. team totals like "Arsenal Over 1.5"), not by market key — so it works
 * for any totals-style key a provider invents, and any board that is not a
 * clean Over/Under set safely falls back to stacked rows.
 */

export type OutcomeLike = { id: string; name: string; label?: string | null };

/** "Over 2.5" / "Under 2.5" / "Arsenal Over 2.5" → prefix + side + line. */
const OU_RE = /^(.*?)(Over|Under)\s+([\d.]+)$/i;

/** One 2-up row: the text before "Over"/"Under" (a team name on team boards,
 *  empty string on the plain match totals) plus the paired cells. Rows are
 *  ordered by first-seen prefix, then ascending by line. */
export type OuGroup<T> = { prefix: string; cells: T[] };

/**
 * Group Over/Under outcomes into paired rows, keyed by BOTH the prefix and the
 * line — "Over 2.5 / Under 2.5" and "Over 3.5 / Under 3.5" are two different
 * rows. (Keying by prefix alone would collapse a multi-line board to its last
 * line.) Returns `null` when the board is not a clean Over/Under set, or when
 * any line is missing one of its two sides — the caller then stacks.
 *
 * The prefix is what lets a MIXED team board ("Team Totals" — both teams in
 * one accordion) render the team name once as a group sub-header instead of
 * repeating "West Ham United …" inside every pill.
 */
export function pairOverUnderGroups<T extends OutcomeLike>(
  outcomes: readonly T[],
): OuGroup<T>[] | null {
  const byPrefix = new Map<string, Map<number, { over?: T; under?: T }>>();
  for (const o of outcomes) {
    const mm = OU_RE.exec(o.name.trim());
    if (!mm) return null; // a non-Over/Under name → not a clean totals board
    const prefix = mm[1].trim();
    const line = Number(mm[3]);
    let lines = byPrefix.get(prefix);
    if (!lines) {
      lines = new Map();
      byPrefix.set(prefix, lines);
    }
    const g = lines.get(line) ?? {};
    if (/^over$/i.test(mm[2])) g.over = o;
    else g.under = o;
    lines.set(line, g);
  }
  if (!byPrefix.size) return null;

  const rows: OuGroup<T>[] = [];
  for (const [prefix, lines] of byPrefix) {
    const entries = [...lines.entries()].sort((a, b) => a[0] - b[0]); // 0.5 → 3.5
    if (!entries.every(([, g]) => g.over && g.under)) return null; // incomplete line
    for (const [, g] of entries) rows.push({ prefix, cells: [g.over as T, g.under as T] });
  }
  return rows;
}

/**
 * Group Over/Under outcomes into rows. Returns rows of TWO outcomes (Over then
 * Under, sorted by line) for a clean totals board, otherwise one outcome per
 * row so the caller can simply stack them.
 */
export function pairOverUnderRows<T extends OutcomeLike>(outcomes: readonly T[]): T[][] {
  const groups = pairOverUnderGroups(outcomes);
  return groups ? groups.map((g) => g.cells) : outcomes.map((x) => [x]);
}

/** True when a board pairs into 2-up rows (i.e. it is a clean Over/Under set). */
export function isPairedBoard<T extends OutcomeLike>(outcomes: readonly T[]): boolean {
  return pairOverUnderGroups(outcomes) !== null;
}
