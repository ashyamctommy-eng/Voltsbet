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

/**
 * Group Over/Under outcomes into rows. Returns rows of TWO outcomes (Over then
 * Under, sorted by line) for a clean totals board, otherwise one outcome per
 * row so the caller can simply stack them.
 */
export function pairOverUnderRows<T extends OutcomeLike>(outcomes: readonly T[]): T[][] {
  const groups = new Map<string, { over?: T; under?: T; line: number }>();
  for (const o of outcomes) {
    const mm = OU_RE.exec(o.name.trim());
    if (!mm) return outcomes.map((x) => [x]);
    const prefix = mm[1].trim();
    const g = groups.get(prefix) ?? { line: Number(mm[3]) };
    if (/^over$/i.test(mm[2])) g.over = o;
    else g.under = o;
    groups.set(prefix, g);
  }
  const all = [...groups.values()];
  if (!all.length || !all.every((g) => g.over && g.under)) return outcomes.map((x) => [x]);
  return all.sort((a, b) => a.line - b.line).map((g) => [g.over as T, g.under as T]);
}

/** True when a board pairs into 2-up rows (i.e. it is an Over/Under set). */
export function isPairedBoard<T extends OutcomeLike>(outcomes: readonly T[]): boolean {
  return pairOverUnderRows(outcomes).some((r) => r.length === 2);
}
