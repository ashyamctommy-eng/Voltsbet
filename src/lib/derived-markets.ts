/**
 * Derived markets — build extra bettable markets from an existing h2h (1/X/2)
 * market using its implied probabilities. No extra provider requests, and the
 * derived odds inherit the source market's margin (fair pricing).
 *
 * Adds: DOUBLE_CHANCE (1X / 12 / X2) and DRAW_NO_BET (1 / 2, draw removed).
 */

type OutcomeLike = { name: string; label?: string | null; odds: string | number };

function prob(odds: string | number): number {
  const o = Number(odds);
  return o > 1 ? 1 / o : 0;
}

/** Identify the three h2h legs: [home, draw, away] (probabilities) or null. */
function h2hLegs(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): { home: number; draw: number; away: number } | null {
  if (outcomes.length !== 3) return null;
  let home = 0, draw = 0, away = 0;
  for (const o of outcomes) {
    const label = (o.label ?? "").toLowerCase();
    const name = o.name.toLowerCase();
    if (label === "1" || name === homeName.toLowerCase()) home = prob(o.odds);
    else if (label === "2" || name === awayName.toLowerCase()) away = prob(o.odds);
    else if (label === "x" || name === "draw") draw = prob(o.odds);
    else return null;
  }
  if (home <= 0 || away <= 0 || draw <= 0) return null;
  return { home, draw, away };
}

function toOdds(p: number): string {
  return (p > 0 ? Math.max(1.01, Math.round((1 / p) * 100) / 100) : 0).toFixed(2);
}

export function deriveDoubleChance(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): { name: string; odds: string }[] | null {
  const legs = h2hLegs(outcomes, homeName, awayName);
  if (!legs) return null;
  return [
    { name: "1X", odds: toOdds(legs.home + legs.draw) },
    { name: "12", odds: toOdds(legs.home + legs.away) },
    { name: "X2", odds: toOdds(legs.draw + legs.away) },
  ];
}

export function deriveDrawNoBet(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): { name: string; odds: string }[] | null {
  const legs = h2hLegs(outcomes, homeName, awayName);
  if (!legs) return null;
  const total = legs.home + legs.away;
  if (total <= 0) return null;
  return [
    { name: homeName, odds: toOdds(legs.home / total) },
    { name: awayName, odds: toOdds(legs.away / total) },
  ];
}
