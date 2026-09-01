/**
 * Odds margin engine.
 *
 * Feed odds (The Odds API etc.) carry the BOOKMAKER's margin — if we pass them
 * through unchanged we make zero money. This module re-prices a market's
 * outcomes so the total implied probability equals `1 + margin` (overround),
 * then re-derives fair decimal odds for each outcome.
 *
 * Example (margin 6%): 1.95 / 3.40 / 3.80 → 1.85 / 3.22 / 3.60 (≈106% book).
 */

export function applyMargin(
  outcomes: { name: string; odds: number }[],
  marginPercent: number,
): { name: string; odds: number }[] {
  if (!outcomes.length) return outcomes;
  if (marginPercent <= 0) return outcomes;

  const raw = outcomes.map((o) => ({ name: o.name, prob: 1 / o.odds }));
  const rawSum = raw.reduce((acc, r) => acc + r.prob, 0);
  if (rawSum <= 0) return outcomes;

  const target = 1 + marginPercent / 100;
  const scale = target / rawSum;

  return raw.map((r) => ({
    name: r.name,
    odds: Math.max(1.01, Math.round((1 / (r.prob * scale)) * 100) / 100),
  }));
}

/** Same as applyMargin but rounds to the nearest 0.05 (betting-friendly grid). */
export function applyMarginGrid(
  outcomes: { name: string; odds: number }[],
  marginPercent: number,
): { name: string; odds: number }[] {
  const priced = applyMargin(outcomes, marginPercent);
  return priced.map((o) => ({ name: o.name, odds: Math.round(o.odds * 20) / 20 }));
}
