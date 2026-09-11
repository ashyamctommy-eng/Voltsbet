/**
 * Odds layout — the ONE place that decides how a market's outcomes are laid
 * out on screen, shared by the home/live feed cards (MatchCard) and the match
 * detail board (FixtureMarkets) so every surface renders identically.
 *
 * The cell itself is stacked (label on top, odds below — see `.odds-btn`), so
 * long option names have room to WRAP instead of being cut off. That is what
 * makes a 3-across grid viable for long names like "Racing Santander & yes".
 *
 * Grid rule:
 *   - Over/Under line markets pair 2-up per line, ascending —
 *       Over 2.5 [2.29] | Under 2.5 [1.66]
 *   - every other board lays out in a 2- or 3-column grid (see gridColumns)
 *
 * The pairing is decided by the OUTCOME NAME SHAPE ("Over 2.5" / "Under 2.5",
 * incl. team totals like "Arsenal Over 1.5"), not by market key — so it works
 * for any totals-style key a provider invents, and any board that is not a
 * clean Over/Under set safely falls back to the plain grid.
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
 * any line is missing one of its two sides — the caller then uses the grid.
 *
 * The prefix is what lets a MIXED team board ("Team Totals" / "Team Total
 * Corners" — both teams in one accordion) render the team name once as a group
 * sub-header instead of repeating it inside every cell.
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
 * Column count for a market grid (labels WRAP, so 3-across is fine even for
 * long team names):
 *   - a lone outcome → 1 column (full width)
 *   - 2 outcomes → 2 columns (Yes/No, Draw No Bet, a handicap pair)
 *   - exactly 4 outcomes → 2 columns, so the second row isn't a lone orphan
 *   - everything else → 3 columns (1X2, Double Chance, Correct Score, the
 *     6-way "1X2 & BTTS" combos → two neat rows of three)
 */
export function gridColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count === 4) return 2;
  return 3;
}
