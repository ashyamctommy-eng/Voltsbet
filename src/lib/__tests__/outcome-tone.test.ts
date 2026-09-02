import { describe, it, expect } from "vitest";
import { outcomeSide, sideTextClass } from "@/lib/outcome-tone";

/**
 * Global outcome color tokens: competing sides must ALWAYS resolve to
 * distinct hues — Home/Under/Yes = first (emerald), Away/Over/No = second
 * (sky), Draw/X = draw (amber).
 */

describe("outcomeSide — 1X2 / labels", () => {
  const ctx = { home: "Ipswich Town", away: "Liverpool" };
  it("maps labels 1 / X / 2", () => {
    expect(outcomeSide({ label: "1", name: "Ipswich Town", ...ctx })).toBe("first");
    expect(outcomeSide({ label: "X", name: "Draw", ...ctx })).toBe("draw");
    expect(outcomeSide({ label: "2", name: "Liverpool", ...ctx })).toBe("second");
  });
  it("maps team names and Draw without labels", () => {
    expect(outcomeSide({ name: "Ipswich Town", ...ctx })).toBe("first");
    expect(outcomeSide({ name: "Liverpool", ...ctx })).toBe("second");
    expect(outcomeSide({ name: "Draw", ...ctx })).toBe("draw");
  });
});

describe("outcomeSide — totals / BTTS / parity", () => {
  it("Under is first (emerald), Over is second (sky)", () => {
    expect(outcomeSide({ name: "Under 2.5" })).toBe("first");
    expect(outcomeSide({ name: "Over 2.5" })).toBe("second");
    expect(outcomeSide({ name: "Over 3.25" })).toBe("second");
    expect(outcomeSide({ name: "Under 9.5" })).toBe("first");
  });
  it("team-total names color by line direction", () => {
    expect(outcomeSide({ name: "Arsenal Under 1.5", home: "Arsenal", away: "Chelsea" })).toBe("first");
    expect(outcomeSide({ name: "Arsenal Over 1.5", home: "Arsenal", away: "Chelsea" })).toBe("second");
  });
  it("Yes/No BTTS and Odd/Even parity", () => {
    expect(outcomeSide({ name: "Yes" })).toBe("first");
    expect(outcomeSide({ name: "No" })).toBe("second");
    expect(outcomeSide({ name: "Odd" })).toBe("first");
    expect(outcomeSide({ name: "Even" })).toBe("second");
  });
});

describe("outcomeSide — scores and specials", () => {
  it("correct score colors by winner", () => {
    expect(outcomeSide({ name: "2-1" })).toBe("first");
    expect(outcomeSide({ name: "1-3" })).toBe("second");
    expect(outcomeSide({ name: "1-1" })).toBe("draw");
  });
  it("double chance", () => {
    expect(outcomeSide({ name: "1X" })).toBe("first");
    expect(outcomeSide({ name: "X2" })).toBe("second");
    expect(outcomeSide({ name: "12" })).toBe("draw");
  });
  it("HT/FT colors by first-half leg", () => {
    expect(outcomeSide({ name: "1/X" })).toBe("first");
    expect(outcomeSide({ name: "2/1" })).toBe("second");
    expect(outcomeSide({ name: "X/X" })).toBe("draw");
  });
});

describe("outcomeSide — neutral", () => {
  it("player lists and ranges have no side", () => {
    expect(outcomeSide({ name: "Mohamed Salah" })).toBeNull();
    expect(outcomeSide({ name: "0-2 Goals" })).toBeNull();
    expect(outcomeSide({ name: "Kylian Mbappe", home: "Ipswich Town", away: "Liverpool" })).toBeNull();
  });
});

describe("sideTextClass", () => {
  it("returns literal token classes (Tailwind scanner-safe)", () => {
    expect(sideTextClass("first")).toBe("text-emerald-400");
    expect(sideTextClass("second")).toBe("text-sky-400");
    expect(sideTextClass("draw")).toBe("text-amber-400");
    expect(sideTextClass(null)).toBeNull();
    expect(sideTextClass(undefined)).toBeNull();
  });
});
