import { describe, it, expect } from "vitest";
import { deriveMarketsFrom1x2, DERIVED_MARKET_KEYS } from "@/lib/derived-markets";

/**
 * 21+ market coverage: the derived engine must produce every market family
 * the product promises, with mathematically sound boards (implied
 * probabilities within bookmaker margins, self-consistent HT/FT marginals).
 */

type Odds = { name: string; label?: string | null; odds: string | number };

const strongHome: Odds[] = [
  { name: "Arsenal", label: "1", odds: 1.45 },
  { name: "Draw", label: "X", odds: 4.5 },
  { name: "Chelsea", label: "2", odds: 7.5 },
];
const balanced: Odds[] = [
  { name: "Barcelona", label: "1", odds: 2.1 },
  { name: "Draw", label: "X", odds: 3.4 },
  { name: "Real Madrid", label: "2", odds: 3.6 },
];

function implied(odds: string): number {
  const o = Number(odds);
  return o > 1 ? 1 / o : 0;
}

function boardSum(outcomes: Odds[]): number {
  return outcomes.reduce((s, o) => s + implied(String(o.odds)), 0);
}

function market(r: ReturnType<typeof deriveMarketsFrom1x2>, key: string) {
  const m = r?.markets.find((m) => m.key === key);
  if (!m) throw new Error(`missing derived market ${key}`);
  return m;
}

describe("deriveMarketsFrom1x2 — 21+ market coverage", () => {
  const r = deriveMarketsFrom1x2(strongHome, "Arsenal", "Chelsea");
  it("runs the full Poisson stage", () => {
    expect(r).not.toBeNull();
    expect(r!.full).toBe(true);
  });

  it("emits all 20 derived market keys (incl. 8 new families)", () => {
    const keys = new Set(r!.markets.map((m) => m.key));
    for (const k of DERIVED_MARKET_KEYS) expect(keys.has(k)).toBe(true);
    expect(keys.has("CORRECT_SCORE")).toBe(true); // engine fills when feed absent
    expect(r!.markets.length).toBe(DERIVED_MARKET_KEYS.length + 1); // + CORRECT_SCORE
  });

  it("prices every outcome at odds ≥ 1.01", () => {
    for (const m of r!.markets) {
      for (const o of m.outcomes) {
        expect(Number(o.odds)).toBeGreaterThanOrEqual(1.01);
        expect(Number.isFinite(Number(o.odds))).toBe(true);
      }
    }
  });

  it("keeps exclusive 3-way boards inside bookmaker margin (sum ∈ [1.0, 1.2])", () => {
    for (const key of ["HT_RESULT", "2H_RESULT", "EUROPEAN_HANDICAP", "WIN_TO_NIL", "HIGHEST_SCORING_HALF", "HT_FT"]) {
      const s = boardSum(market(r, key).outcomes);
      expect(s, `${key} sum=${s.toFixed(4)}`).toBeGreaterThanOrEqual(1.0);
      expect(s, `${key} sum=${s.toFixed(4)}`).toBeLessThanOrEqual(1.2);
    }
  });

  it("keeps 2-way boards inside margin", () => {
    for (const key of ["DRAW_NO_BET", "BTTS", "FIRST_HALF_BTTS", "GOAL_PARITY"]) {
      const s = boardSum(market(r, key).outcomes);
      expect(s, `${key} sum=${s.toFixed(4)}`).toBeGreaterThanOrEqual(1.0);
      expect(s, `${key} sum=${s.toFixed(4)}`).toBeLessThanOrEqual(1.2);
    }
  });

  it("overlapping 'pick-any' boards (Double Chance, Clean Sheet) carry ~2× margin by design", () => {
    // DC: 1X / 12 / X2 — outcomes overlap on the draw, so implied sum ≈ 2·overround.
    const dc = boardSum(market(r, "DOUBLE_CHANCE").outcomes);
    expect(dc).toBeGreaterThanOrEqual(1.8);
    expect(dc).toBeLessThanOrEqual(2.4);
    // Clean Sheet: two independent pairs (home CS/concede, away CS/concede).
    const cs = market(r, "CLEAN_SHEET").outcomes;
    const homePair = cs.filter((o) => o.name.startsWith("Arsenal"));
    const awayPair = cs.filter((o) => o.name.startsWith("Chelsea"));
    expect(boardSum(homePair)).toBeGreaterThanOrEqual(1.0);
    expect(boardSum(homePair)).toBeLessThanOrEqual(1.2);
    expect(boardSum(awayPair)).toBeGreaterThanOrEqual(1.0);
    expect(boardSum(awayPair)).toBeLessThanOrEqual(1.2);
  });

  it("correct score: 21 outcomes, plausible top line, result labels", () => {
    const cs = market(r, "CORRECT_SCORE");
    expect(cs.outcomes.length).toBe(21);
    const names = cs.outcomes.map((o) => o.name);
    expect(names).toContain("1-0");
    expect(names).toContain("2-0");
    expect(names).toContain("Any Other Home Win");
    expect(names).toContain("Any Other Draw");
    expect(names).toContain("Any Other Away Win");
    // Strong home favourite → a home-win score must be the top line
    expect(cs.outcomes[0].name).toBe("1-0");
    expect(cs.outcomes[0].label).toBe("1");
    // Implied probability of the top scoreline < 1X2 home win (sanity)
    expect(implied(cs.outcomes[0].odds)).toBeLessThan(0.6);
  });

  it("HT/FT: 9 outcomes, FT marginal tracks the source 1X2", () => {
    const htft = market(r, "HT_FT");
    expect(htft.outcomes.length).toBe(9);
    const labels = ["1", "X", "2"];
    const names = new Set(htft.outcomes.map((o) => o.name));
    for (const a of labels) for (const b of labels) expect(names.has(`${a}/${b}`)).toBe(true);

    // FT marginal implied probs (scaled by the 9-way margin) vs source 1X2
    const margin = boardSum(htft.outcomes); // ≈ 9-way overround
    const ftImplied = {
      "1": 0, X: 0, "2": 0,
    } as Record<string, number>;
    for (const o of htft.outcomes) {
      const ft = o.name.split("/")[1];
      ftImplied[ft] += implied(String(o.odds));
    }
    // implied = margin * P(FT); compare ratios with source (normalized) probs
    const src = { "1": 1 / 1.45, X: 1 / 4.5, "2": 1 / 7.5 };
    const srcSum = src["1"] + src.X + src["2"];
    const ratioHome = ftImplied["1"] / margin / (src["1"] / srcSum);
    const ratioAway = ftImplied["2"] / margin / (src["2"] / srcSum);
    expect(ratioHome).toBeGreaterThan(0.9);
    expect(ratioHome).toBeLessThan(1.1);
    expect(ratioAway).toBeGreaterThan(0.9);
    expect(ratioAway).toBeLessThan(1.1);
  });

  it("European handicap: probabilities partition the draw line", () => {
    const eh = market(r, "EUROPEAN_HANDICAP");
    const byLabel = Object.fromEntries(eh.outcomes.map((o) => [o.label, o]));
    // P(away +1) = P(d ≤ 0) = P(loss) + P(draw); implied ≈ (loss+draw)*margin
    const s = boardSum(eh.outcomes);
    const lossDrawImplied = implied(String(byLabel["2"].odds)) + implied(String(byLabel["X"].odds));
    expect(lossDrawImplied / s).toBeGreaterThan(0.45); // strong home fav: away/draw side is the bulk
  });

  it("balanced fixture still derives (no degenerate 1X2)", () => {
    const rb = deriveMarketsFrom1x2(balanced, "Barcelona", "Real Madrid");
    expect(rb).not.toBeNull();
    expect(rb!.full).toBe(true);
    const cs = market(rb, "CORRECT_SCORE");
    expect(cs.outcomes[0].label).toBe("1"); // 1-0 or 2-1 etc. — home side of a near-balance game
    const winToNil = market(rb, "WIN_TO_NIL");
    const home = winToNil.outcomes.find((o) => o.name.includes("Barcelona"))!;
    const away = winToNil.outcomes.find((o) => o.name.includes("Real Madrid"))!;
    expect(implied(String(home.odds))).toBeGreaterThan(implied(String(away.odds)));
  });

  it("non-3-way source (moneyline) → null, gracefully", () => {
    const ml: Odds[] = [
      { name: "Lakers", label: "1", odds: 1.8 },
      { name: "Celtics", label: "2", odds: 2.05 },
    ];
    expect(deriveMarketsFrom1x2(ml, "Lakers", "Celtics")).toBeNull();
  });
});
