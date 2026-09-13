import { describe, expect, it } from "vitest";
import { estimateSyncCost, estimateDetailCost, LIST_MARKETS } from "@/lib/odds-cost-core";

/**
 * The production configuration this was written against (verified from
 * Admin → API Settings on 2026-09-13). Keeping it as a fixture means the cost
 * model can't silently drift away from the numbers the operator was shown.
 */
const LIVE = {
  leagues: 48, // whitelisted soccer leagues
  markets: [
    "h2h", "btts", "draw_no_bet", "totals", "correct_score", "alternate_totals",
    "team_totals", "alternate_team_totals", "double_chance", "h2h_3_way", "alternate_spreads",
  ],
  regions: "eu",
  eventLeagues: 7,
  eventLimit: 2,
};

describe("estimateSyncCost", () => {
  it("splits the live config into the cheap list pass and the per-event pass", () => {
    const e = estimateSyncCost(LIVE);
    // "spreads" is NOT in the saved menu — only h2h and totals ride the list pass.
    expect(e.listMarkets).toBe(2);
    expect(e.extendedMarkets).toBe(9);
    expect(e.maxEvents).toBe(14); // 7 featured leagues × 2 events
    expect(e.listCredits).toBe(96); // 48 leagues × 2 × 1 region
    expect(e.eventCredits).toBe(126); // 14 events × 9 × 1
    expect(e.totalCredits).toBe(222);
  });

  it("prices the cadences the operator actually asks about", () => {
    const e = estimateSyncCost(LIVE);
    expect(e.monthlyAt(24)).toBe(159_840); // hourly — the default 60-min throttle
    expect(e.monthlyAt(8)).toBe(53_280); // every 3 hours
    expect(e.monthlyAt(96)).toBe(639_360); // every 15 minutes
  });

  it("counts an unlisted market as expensive, not free", () => {
    // The trap this model exists to expose: 'correct_score' looks like one more
    // tick but is charged per featured event, not per league.
    const withCorrectScore = estimateSyncCost({ ...LIVE, markets: [...LIVE.markets, "corners"] });
    expect(withCorrectScore.extendedMarkets).toBe(10);
    expect(withCorrectScore.totalCredits).toBeGreaterThan(estimateSyncCost(LIVE).totalCredits);
  });

  it("only the list pass scales with leagues", () => {
    const doubled = estimateSyncCost({ ...LIVE, leagues: 96 });
    // list doubles; the event pass does NOT move (it is priced per featured event)
    expect(doubled.listCredits).toBe(192);
    expect(doubled.eventCredits).toBe(126);
  });

  it("regions multiply both passes", () => {
    const euUs = estimateSyncCost({ ...LIVE, regions: "eu,us" });
    expect(euUs.regions).toBe(2);
    expect(euUs.listCredits).toBe(192);
    expect(euUs.eventCredits).toBe(252);
  });

  it("treats an empty selection as zero, and turns the event pass off with no extended markets", () => {
    expect(estimateSyncCost({ ...LIVE, markets: [] }).totalCredits).toBe(0);
    const coreOnly = estimateSyncCost({ ...LIVE, markets: ["h2h", "totals"] });
    expect(coreOnly.extendedMarkets).toBe(0);
    expect(coreOnly.eventCredits).toBe(0);
    expect(coreOnly.totalCredits).toBe(96); // h2h + totals, 48 leagues, 1 region
  });

  it("turns the event pass off at limit 0", () => {
    expect(estimateSyncCost({ ...LIVE, eventLimit: 0 }).eventCredits).toBe(0);
  });

  it("is pure — no negative or fractional credits from junk input", () => {
    const junk = estimateSyncCost({ ...LIVE, leagues: -5, eventLimit: 2.6, eventLeagues: NaN });
    expect(junk.listCredits).toBe(0);
    expect(junk.totalCredits).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(junk.totalCredits)).toBe(true);
  });

  it("keeps LIST_MARKETS in sync with the provider's cheap set", () => {
    expect([...LIST_MARKETS]).toEqual(["h2h", "spreads", "totals"]);
  });
});

describe("estimateDetailCost (Tier 2)", () => {
  it("is priced per customer view, not per sync run", () => {
    const d = estimateDetailCost({ markets: ["corners", "cards", "total_cards", "h2h_h1", "h2h_h2"], regions: "eu" });
    expect(d.perView).toBe(5);
  });

  it("ignores blank entries", () => {
    expect(estimateDetailCost({ markets: ["corners", "", "  "], regions: "eu" }).markets).toBe(1);
  });
});
