import { describe, it, expect } from "vitest";
import { isHalfTimeScore, scoreToGameStatus } from "../game-status";
import { isTickingClock, normalizeElapsed } from "../match-view";
import { liveContext } from "../kickoff";

/**
 * Half-time regression: the estimated clock turns into "HT" at 45–60 minutes.
 * The sweep used to keep the row at LIVE with clock "HT", and the card only
 * rendered a ticking counter — which returns null for a non-numeric clock, so
 * the timer simply vanished with no indication of half time.
 */
describe("half-time detection", () => {
  it("recognises the interval from the estimated clock/period", () => {
    expect(isHalfTimeScore({ period: "HT", clock: "HT" })).toBe(true);
    expect(isHalfTimeScore({ period: "Halftime", clock: null })).toBe(true);
    expect(isHalfTimeScore({ period: "1H", clock: "45'" })).toBe(false);
    expect(isHalfTimeScore({ period: "2H", clock: "67'" })).toBe(false);
  });

  it("persists HALF_TIME for soccer only", () => {
    const soccer = { status: "live" as const, sportKey: "soccer_epl", period: "HT", clock: "HT" };
    expect(scoreToGameStatus(soccer)).toBe("HALF_TIME");
    // Basketball at 46 real minutes is NOT at half time — keep it LIVE.
    const hoops = { status: "live" as const, sportKey: "basketball_nba", period: "HT", clock: "HT" };
    expect(scoreToGameStatus(hoops)).toBe("LIVE");
  });

  it("keeps the other transitions intact", () => {
    expect(scoreToGameStatus({ status: "finished", sportKey: "soccer_epl" })).toBe("FINISHED");
    expect(scoreToGameStatus({ status: "live", sportKey: "soccer_epl", clock: "67:12", period: "2H" })).toBe("LIVE");
    expect(scoreToGameStatus({ status: "scheduled", sportKey: "soccer_epl" })).toBe("SCHEDULED");
    expect(scoreToGameStatus({ status: "postponed", sportKey: "soccer_epl" })).toBe("SCHEDULED");
    expect(scoreToGameStatus({ status: "cancelled", sportKey: "soccer_epl" })).toBe("SCHEDULED");
  });
});

describe("card timer vs status label", () => {
  it("only ticks a numeric clock", () => {
    expect(isTickingClock("87:42")).toBe(true);
    expect(isTickingClock("87:42'")).toBe(true);
    expect(isTickingClock("87")).toBe(true);
    expect(isTickingClock("87'")).toBe(true);
    expect(isTickingClock("HT")).toBe(false);
    expect(isTickingClock("Set 3")).toBe(false);
    expect(isTickingClock(null)).toBe(false);
  });

  it("renders an explicit half-time label (never a blank timer)", () => {
    // The regression: normalizeElapsed("HT") is truthy but untickable, so the
    // card must fall back to the context label.
    expect(normalizeElapsed("HT")).toBe("HT");
    expect(isTickingClock(normalizeElapsed("HT"))).toBe(false);
    expect(liveContext("LIVE", "HT", "HT")).toBe("Halftime HT");
    expect(liveContext("HALF_TIME", null, null)).toBe("Halftime HT");
    // Numeric clocks collapse to the minute for the compact badge.
    expect(liveContext("LIVE", "67:12", "2H")).toBe("67'");
    expect(liveContext("LIVE", "45'", "1H")).toBe("45'");
  });
});
