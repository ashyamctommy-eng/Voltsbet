import { describe, it, expect } from "vitest";
import { hasBettableMarkets, isBettableMarket, isLiveStatus } from "../game-status";
import { LIVE_FEED_FRESH_MINUTES, liveFeedWhere } from "../live-feed";

/**
 * Regression suite for the /live discrepancies:
 *  1. bottom-nav badge (3) vs page header (42) — caused by the page also
 *     counting rows whose legacy `live` flag was stale-true;
 *  2. "Market Suspended (+0 Markets)" cards — rows with no bettable odds.
 */
describe("isLiveStatus is status-driven only", () => {
  it("accepts the three live statuses", () => {
    expect(isLiveStatus("LIVE")).toBe(true);
    expect(isLiveStatus("HALF_TIME")).toBe(true);
    expect(isLiveStatus("IN_PLAY")).toBe(true);
  });

  it("IGNORES the legacy live flag (the 3-vs-42 regression)", () => {
    // A finished row left with live:true must never count as live again.
    expect(isLiveStatus("FINISHED", true)).toBe(false);
    expect(isLiveStatus("SCHEDULED", true)).toBe(false);
    expect(isLiveStatus("CANCELLED", true)).toBe(false);
  });
});

describe("bettable-market predicate", () => {
  it("rejects markets a user cannot bet", () => {
    expect(hasBettableMarkets([])).toBe(false);
    expect(hasBettableMarkets(null)).toBe(false);
    // suspended market
    expect(hasBettableMarkets([{ status: "SUSPENDED", outcomes: [{ status: "ACTIVE", odds: 2 }] }])).toBe(false);
    // closed / settled market
    expect(hasBettableMarkets([{ status: "CLOSED", outcomes: [{ status: "ACTIVE", odds: 2 }] }])).toBe(false);
    // open market but every outcome suspended
    expect(hasBettableMarkets([{ status: "OPEN", outcomes: [{ status: "SUSPENDED", odds: 2 }] }])).toBe(false);
    // unpriced placeholder odds
    expect(hasBettableMarkets([{ status: "OPEN", outcomes: [{ status: "ACTIVE", odds: 1 }] }])).toBe(false);
  });

  it("accepts an OPEN market with an ACTIVE priced outcome", () => {
    expect(isBettableMarket({ status: "OPEN", outcomes: [{ status: "ACTIVE", odds: 1.85 }] })).toBe(true);
    expect(hasBettableMarkets([{ status: "OPEN", outcomes: [{ status: "ACTIVE", odds: 2.1 }] }])).toBe(true);
  });
});

describe("liveFeedWhere — one predicate for badge, header and cards", () => {
  const now = new Date("2026-09-10T20:00:00Z");
  const where = liveFeedWhere(now);

  it("excludes orphan/seed rows", () => {
    expect(where.externalId).toEqual({ not: null });
    expect(where.source).toBe("API");
  });

  it("counts only real live statuses", () => {
    expect(where.status.in).toEqual(["LIVE", "HALF_TIME", "IN_PLAY"]);
  });

  it("requires at least one bettable market", () => {
    expect(where.markets.some).toMatchObject({
      status: "OPEN",
      outcomes: { some: { status: "ACTIVE", odds: { gt: 1 } } },
    });
  });

  it("hides rows the API stopped reporting for more than the fresh window", () => {
    const cutoff = new Date(now.getTime() - LIVE_FEED_FRESH_MINUTES * 60_000);
    expect(where.updatedAt.gte.toISOString()).toBe(cutoff.toISOString());
    expect(LIVE_FEED_FRESH_MINUTES).toBe(30);
  });
});
