/**
 * Derived-markets engine — builds 50+ bettable market lines from a single
 * priced 1X2 (h2h) market using Poisson / Skellam match modelling. Runs
 * during every sync cycle with ZERO manual input and ZERO extra provider
 * requests; the derived odds inherit the source market's margin (juice).
 *
 * Derivation chain:
 *   1. 1X2 probabilities → implied match scoring rates λhome, λaway
 *      (coordinate descent over the Skellam difference distribution).
 *   2. Every market below is a closed-form function of (λh, λa):
 *        DOUBLE_CHANCE     1X / 12 / X2          (3 outcomes)
 *        DRAW_NO_BET       draw removed          (2)
 *        BTTS              both teams score      (2)
 *        ALTERNATE_TOTALS  O/U 0.5 → 5.5         (12)
 *        ALTERNATE_SPREAD  AH -2.5 → +2.5        (12)
 *        TEAM_TOTALS_HOME  home O/U 0.5 → 3.5    (8)
 *        TEAM_TOTALS_AWAY  away O/U 0.5 → 3.5    (8)
 *        HT_RESULT         1st-half 1/X/2        (3)  — λ scaled by 0.47
 *        OVER_UNDER_1H     1st-half O/U 0.5,1.5  (4)
 *        2H_RESULT         2nd-half 1/X/2        (3)  — λ scaled by 0.53
 *        OVER_UNDER_2H     2nd-half O/U 0.5,1.5  (4)
 *        GOAL_PARITY       Even / Odd goals      (2)
 *   = 63 derived outcome lines per priced fixture.
 *
 * Modelling assumptions (documented, standard bookmaking practice):
 *   - Goals per team ~ independent Poisson (bivariate-Poisson proxy).
 *   - Half-time split: 47% of FT expectation in the 1st half, 53% 2nd.
 *   - Half-time 1X2 is the independent-half approximation (FT result given
 *     HT is a conditional that requires score paths we don't model).
 *   - No goals-based correlation between teams (BTTS/parity are Poisson
 *     marginals — the standard shortcut without defensive ratings).
 *
 * Ownership rules (see sync.ts): the engine only writes markets it created
 * (isDerived=true). If the feed later prices the same key, the API path
 * claims it (isDerived=false) and the engine backs off.
 */

type OutcomeLike = { name: string; label?: string | null; odds: string | number };

export type DerivedOutcome = { name: string; label?: string | null; odds: string };
export type DerivedMarket = { key: string; name: string; sortOrder: number; outcomes: DerivedOutcome[] };

/** Keys the derived engine owns. API markets mapping to these keys claim
 *  them (see sync.upsertMarkets) and the engine then stays away. */
export const DERIVED_MARKET_KEYS = [
  "DOUBLE_CHANCE",
  "DRAW_NO_BET",
  "BTTS",
  "ALTERNATE_TOTALS",
  "ALTERNATE_SPREAD",
  "TEAM_TOTALS_HOME",
  "TEAM_TOTALS_AWAY",
  "HT_RESULT",
  "OVER_UNDER_1H",
  "2H_RESULT",
  "OVER_UNDER_2H",
  "GOAL_PARITY",
] as const;

/** Env kill-switch: ENABLE_DERIVED_MARKETS=false turns the engine off. */
export const DERIVE_ENABLED = process.env.ENABLE_DERIVED_MARKETS !== "false";

const HT_GOAL_SHARE = 0.47; // 1st-half share of full-time expectation
const MAX_GOALS = 40; // Poisson truncation tail
const MIN_ODDS = 1.01;

function prob(odds: string | number): number {
  const o = Number(odds);
  return o > 1 ? 1 / o : 0;
}

function toOdds(p: number): string {
  return (p > 0 ? Math.max(MIN_ODDS, Math.round((1 / p) * 100) / 100) : 0).toFixed(2);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Poisson PMF P(X = k) for k = 0..MAX_GOALS (recurrence, stable). */
function poissonPmf(l: number): number[] {
  const out: number[] = new Array(MAX_GOALS + 1);
  out[0] = Math.exp(-l);
  for (let k = 1; k <= MAX_GOALS; k++) out[k] = (out[k - 1] * l) / k;
  return out;
}

/** P(diff ≥ thr) for diff = H − A with H~Poisson(lh), A~Poisson(la).
 *  O(N) via suffix sums: P(diff ≥ thr) = Σ_a P(A=a) · P(H ≥ a + thr). */
function spreadCoverProb(lh: number, la: number, thr: number): number {
  const N = MAX_GOALS;
  if (thr <= -N) return 1;
  if (thr > N) return 0;
  const pH = poissonPmf(lh);
  const pA = poissonPmf(la);
  const sufH: number[] = new Array(N + 2).fill(0);
  for (let t = N; t >= 0; t--) sufH[t] = sufH[t + 1] + pH[t];
  let prob = 0;
  for (let a = 0; a <= N; a++) {
    const t = a + thr; // need P(H ≥ t)
    if (t <= 0) prob += pA[a];
    else if (t <= N) prob += pA[a] * sufH[t];
  }
  return Math.max(0, Math.min(1, prob));
}

/** P(H−A ≥ 1), P(H−A = 0), P(H−A ≤ −1). */
function diffProbs(lh: number, la: number): { win: number; draw: number; loss: number } {
  const win = spreadCoverProb(lh, la, 1);
  const loss = 1 - spreadCoverProb(lh, la, 0); // P(diff ≤ −1)
  const draw = Math.max(0, 1 - win - loss);
  return { win, draw, loss };
}

/** Bisection on a monotone-increasing f: find x ∈ [lo, hi] with f(x) ≈ target. */
function bisect(f: (x: number) => number, target: number, lo: number, hi: number): number {
  let l = lo, r = hi;
  for (let i = 0; i < 40; i++) {
    const m = (l + r) / 2;
    if (f(m) < target) l = m;
    else r = m;
  }
  return (l + r) / 2;
}

/** Estimate (λhome, λaway) from normalized 1X2 probabilities via coordinate
 *  descent: P(win) is monotone ↑ in λh (λa fixed), P(loss) monotone ↑ in λa. */
function lambdasFromProbs(p1: number, pX: number, p2: number): { lh: number; la: number } | null {
  if (!(p1 > 0.03 && p2 > 0.03 && pX > 0.015)) return null;
  let lh = clamp(-Math.log(1 - p1) * 0.95, 0.1, 4.0);
  let la = clamp(-Math.log(1 - p2) * 0.95, 0.1, 4.0);
  for (let iter = 0; iter < 8; iter++) {
    lh = bisect((x) => spreadCoverProb(x, la, 1), p1, 0.05, 5.0);
    // P(loss) = P(diff ≤ −1) = 1 − P(diff ≥ 0), monotone ↑ in λa.
    la = bisect((x) => 1 - spreadCoverProb(lh, x, 0), p2, 0.05, 5.0);
  }
  const { win, loss } = diffProbs(lh, la);
  // Convergence guard — if the fit failed, drop Poisson-dependent markets
  // (caller falls back to probability-only derivations).
  if (Math.abs(win - p1) > 0.03 || Math.abs(loss - p2) > 0.03) return null;
  return { lh, la };
}

/** P(X ≥ k) for X ~ Poisson(λ). */
function poissonTail(l: number, k: number): number {
  if (k <= 0) return 1;
  // P(≥k) = 1 − P(≤k−1); compute the CDF up to k−1.
  let p = Math.exp(-l);
  let cdf = p;
  for (let i = 1; i < k; i++) {
    p = (p * l) / i;
    cdf += p;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** Total-goals parity: P(even) = (1 + e^{−2λ})/2 for X ~ Poisson(λ). */
function parityProbs(lh: number, la: number): { even: number; odd: number } {
  const l = lh + la;
  const even = (1 + Math.exp(-2 * l)) / 2;
  return { even, odd: 1 - even };
}

/** Per-market margin: full base overround for ≤3 outcomes, scaled down for
 *  multi-outcome boards (books juice 12-way lines far less). */
function marginFor(overround: number, outcomeCount: number): number {
  const base = clamp(overround, 1.01, 1.15);
  return outcomeCount > 3 ? 1 + (base - 1) * (3 / outcomeCount) : base;
}

function priced(p: number, margin: number): string {
  return toOdds(p * margin);
}

/** 1X2 legs as raw implied probabilities: {home, draw, away, overround} or null. */
function h2hLegs(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): { home: number; draw: number; away: number; overround: number } | null {
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
  return { home, draw, away, overround: home + draw + away };
}

export type DerivedEngineResult = {
  markets: DerivedMarket[];
  /** True when the Poisson stage succeeded (all 12 markets). False → only
   *  probability-based markets (DC/DNB) are returned. */
  full: boolean;
};

/**
 * Derive the full market board from a 3-way h2h market.
 * Returns null when the source is not a valid 3-way market or the engine is
 * disabled (ENABLE_DERIVED_MARKETS=false).
 */
export function deriveMarketsFrom1x2(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): DerivedEngineResult | null {
  if (!DERIVE_ENABLED) return null;
  const legs = h2hLegs(outcomes, homeName, awayName);
  if (!legs) return null;
  const { overround } = legs;
  const sum = legs.home + legs.draw + legs.away;
  const p1 = legs.home / sum;
  const pX = legs.draw / sum;
  const p2 = legs.away / sum;

  const markets: DerivedMarket[] = [];

  // ── Probability-only derivations (always available) ────────────────────
  const mDC = marginFor(overround, 3);
  markets.push({
    key: "DOUBLE_CHANCE",
    name: "Double Chance",
    sortOrder: 10,
    outcomes: [
      { name: "1X", odds: priced(p1 + pX, mDC) },
      { name: "12", odds: priced(p1 + p2, mDC) },
      { name: "X2", odds: priced(pX + p2, mDC) },
    ],
  });
  const dnbt = p1 + p2;
  if (dnbt > 0) {
    markets.push({
      key: "DRAW_NO_BET",
      name: "Draw No Bet",
      sortOrder: 11,
      outcomes: [
        { name: homeName, label: "1", odds: priced(p1 / dnbt, marginFor(overround, 2)) },
        { name: awayName, label: "2", odds: priced(p2 / dnbt, marginFor(overround, 2)) },
      ],
    });
  }

  // ── Poisson-dependent derivations (need λ estimates) ───────────────────
  const lam = lambdasFromProbs(p1, pX, p2);
  if (!lam) return { markets, full: false };
  const { lh, la } = lam;

  // BTTS — Poisson marginals
  const yes = (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
  markets.push({
    key: "BTTS",
    name: "Both Teams to Score",
    sortOrder: 12,
    outcomes: [
      { name: "Yes", odds: priced(yes, marginFor(overround, 2)) },
      { name: "No", odds: priced(1 - yes, marginFor(overround, 2)) },
    ],
  });

  // Alternate totals — O/U 0.5 … 5.5
  const altTot: DerivedOutcome[] = [];
  for (let line = 0.5; line <= 5.5; line += 1) {
    const pOver = poissonTail(lh + la, Math.ceil(line));
    altTot.push({ name: `Over ${line}`, odds: priced(pOver, marginFor(overround, 12)) });
    altTot.push({ name: `Under ${line}`, odds: priced(1 - pOver, marginFor(overround, 12)) });
  }
  markets.push({ key: "ALTERNATE_TOTALS", name: "Alternate Totals", sortOrder: 13, outcomes: altTot });

  // Alternate spreads — home handicap −2.5 … +2.5 (half lines only, no
  // pushes). Home covers line h ⟺ diff ≥ round(0.5 − h).
  const altSpr: DerivedOutcome[] = [];
  for (const h of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
    const thr = Math.round(0.5 - h);
    const pHome = spreadCoverProb(lh, la, thr);
    altSpr.push({ name: `${homeName} ${h > 0 ? "+" : ""}${h}`, label: "1", odds: priced(pHome, marginFor(overround, 12)) });
    altSpr.push({ name: `${awayName} ${h > 0 ? "-" : "+"}${Math.abs(h)}`, label: "2", odds: priced(1 - pHome, marginFor(overround, 12)) });
  }
  markets.push({ key: "ALTERNATE_SPREAD", name: "Alternate Handicaps", sortOrder: 14, outcomes: altSpr });

  // Team totals — home & away O/U 0.5 … 3.5
  const teamOutcomes = (lam: number, label: string): DerivedOutcome[] => {
    const out: DerivedOutcome[] = [];
    for (let line = 0.5; line <= 3.5; line += 1) {
      const pOver = poissonTail(lam, Math.ceil(line));
      out.push({ name: `Over ${line}`, label, odds: priced(pOver, marginFor(overround, 8)) });
      out.push({ name: `Under ${line}`, label, odds: priced(1 - pOver, marginFor(overround, 8)) });
    }
    return out;
  };
  markets.push({ key: "TEAM_TOTALS_HOME", name: "Home Team Totals", sortOrder: 15, outcomes: teamOutcomes(lh, "1") });
  markets.push({ key: "TEAM_TOTALS_AWAY", name: "Away Team Totals", sortOrder: 16, outcomes: teamOutcomes(la, "2") });

  // Half-time lines — 47% / 53% split of the FT expectation
  const lh1 = lh * HT_GOAL_SHARE;
  const la1 = la * HT_GOAL_SHARE;
  const lh2 = lh * (1 - HT_GOAL_SHARE);
  const la2 = la * (1 - HT_GOAL_SHARE);
  const halfH2h = (l1: number, l2: number, key: string, name: string, order: number) => {
    const { win, draw, loss } = diffProbs(l1, l2);
    const m = marginFor(overround, 3);
    markets.push({
      key,
      name,
      sortOrder: order,
      outcomes: [
        { name: homeName, label: "1", odds: priced(win, m) },
        { name: "Draw", label: "X", odds: priced(draw, m) },
        { name: awayName, label: "2", odds: priced(loss, m) },
      ],
    });
  };
  halfH2h(lh1, la1, "HT_RESULT", "1st Half - Match Result", 17);
  halfH2h(lh2, la2, "2H_RESULT", "2nd Half - Match Result", 19);
  const halfTotals = (l1: number, l2: number, key: string, name: string, order: number) => {
    const out: DerivedOutcome[] = [];
    for (const line of [0.5, 1.5]) {
      const pOver = poissonTail(l1 + l2, Math.ceil(line));
      out.push({ name: `Over ${line}`, odds: priced(pOver, marginFor(overround, 4)) });
      out.push({ name: `Under ${line}`, odds: priced(1 - pOver, marginFor(overround, 4)) });
    }
    markets.push({ key, name, sortOrder: order, outcomes: out });
  };
  halfTotals(lh1, la1, "OVER_UNDER_1H", "1st Half - Over/Under", 18);
  halfTotals(lh2, la2, "OVER_UNDER_2H", "2nd Half - Over/Under", 20);

  // Goal parity — even/odd total goals
  const { even, odd } = parityProbs(lh, la);
  markets.push({
    key: "GOAL_PARITY",
    name: "Goal Parity (Odd/Even)",
    sortOrder: 21,
    outcomes: [
      { name: "Even", odds: priced(even, marginFor(overround, 2)) },
      { name: "Odd", odds: priced(odd, marginFor(overround, 2)) },
    ],
  });

  return { markets, full: true };
}

/* Backwards-compatible wrappers (older call sites) */
export function deriveDoubleChance(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): { name: string; odds: string }[] | null {
  const r = deriveMarketsFrom1x2(outcomes, homeName, awayName);
  return r?.markets.find((m) => m.key === "DOUBLE_CHANCE")?.outcomes.map((o) => ({ name: o.name, odds: o.odds })) ?? null;
}

export function deriveDrawNoBet(
  outcomes: OutcomeLike[],
  homeName: string,
  awayName: string,
): { name: string; odds: string }[] | null {
  const r = deriveMarketsFrom1x2(outcomes, homeName, awayName);
  return r?.markets.find((m) => m.key === "DRAW_NO_BET")?.outcomes.map((o) => ({ name: o.name, odds: o.odds })) ?? null;
}
