import { describe, it, expect } from "vitest";
import { DEFAULT_DETAIL_MARKETS, isDetailFresh } from "../detail-odds";
import { activeMarketCount, hasAnyOutcomes } from "../game-status";

/** TIER 2 cache: a detail-page hit inside the TTL must not call the API. */
describe("isDetailFresh", () => {
  const now = Date.parse("2026-09-10T20:00:00Z");

  it("serves cache inside the 45s window", () => {
    expect(isDetailFresh(now - 44_000, 45, now)).toBe(true);
    expect(isDetailFresh(now - 1_000, 45, now)).toBe(true);
  });

  it("refetches at/after the TTL", () => {
    expect(isDetailFresh(now - 45_000, 45, now)).toBe(false);
    expect(isDetailFresh(now - 60_000, 45, now)).toBe(false);
  });

  it("treats a missing/invalid marker as stale", () => {
    expect(isDetailFresh(null, 45, now)).toBe(false);
    expect(isDetailFresh(NaN, 45, now)).toBe(false);
    expect(isDetailFresh(now + 5_000, 45, now)).toBe(true); // clock skew is fine
  });

  it("honours a custom TTL", () => {
    expect(isDetailFresh(now - 90_000, 120, now)).toBe(true);
    expect(isDetailFresh(now - 90_000, 30, now)).toBe(false);
  });

  it("ships the spec default deep menu", () => {
    expect(DEFAULT_DETAIL_MARKETS).toEqual([
      "alternate_totals",
      "alternate_spreads",
      "h2h_h1",
      "h2h_h2",
      "team_totals",
    ]);
  });
});

/** TIER 3 counter: the "+N Markets" badge counts only bettable markets. */
describe("activeMarketCount / hasAnyOutcomes", () => {
  it("counts only OPEN markets with an ACTIVE priced outcome", () => {
    const markets = [
      { status: "OPEN", outcomes: [{ status: "ACTIVE", odds: 1.9 }] }, // count
      { status: "OPEN", outcomes: [{ status: "ACTIVE", odds: 1 }] }, // placeholder price
      { status: "OPEN", outcomes: [{ status: "SUSPENDED", odds: 2 }] },
      { status: "SUSPENDED", outcomes: [{ status: "ACTIVE", odds: 2 }] },
      { status: "SETTLED", outcomes: [{ status: "ACTIVE", odds: 2 }] },
      { status: "OPEN", outcomes: [] },
    ];
    expect(activeMarketCount(markets)).toBe(1);
  });

  it("returns 0 for a bare card so the badge can be hidden", () => {
    expect(activeMarketCount([])).toBe(0);
    expect(activeMarketCount(null)).toBe(0);
    expect(activeMarketCount([{ status: "SUSPENDED", outcomes: [] }])).toBe(0);
  });

  it("distinguishes 'no bettable market' from 'no outcomes at all'", () => {
    // Suspended market rows exist → the card has outcomes, so it must NOT be
    // labelled "Market Suspended" (spec §4).
    const suspendedWithOutcomes = [{ status: "SUSPENDED", outcomes: [{ status: "SUSPENDED", odds: 2 }] }];
    expect(activeMarketCount(suspendedWithOutcomes)).toBe(0);
    expect(hasAnyOutcomes(suspendedWithOutcomes)).toBe(true);
    // Truly bare card → "Market Suspended" is the right message.
    expect(hasAnyOutcomes([])).toBe(false);
    expect(hasAnyOutcomes([{ status: "OPEN", outcomes: [] }])).toBe(false);
  });
});
