import { describe, it, expect } from "vitest";
import { outcomeSide, sideTextClass, isTwoWayMarket } from "@/lib/outcome-tone";

/**
 * Global outcome color tokens — STRICTLY two-outcome (two-variable) markets:
 *   Column 1 / option A — Over · Home · Team 1 · Yes → emerald
 *   Column 2 / option B — Under · Away · Team 2 · No  → sky
 * 1X2 and other 3+-way boards are never color-coded (isTwoWayMarket gate).
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

describe("outcomeSide — totals / BTTS / parity (column convention)", () => {
  it("Over is column 1 (emerald), Under is column 2 (sky)", () => {
    expect(outcomeSide({ name: "Over 2.5" })).toBe("first");
    expect(outcomeSide({ name: "Under 2.5" })).toBe("second");
    expect(outcomeSide({ name: "Over 3.25" })).toBe("first");
    expect(outcomeSide({ name: "Under 9.5" })).toBe("second");
  });
  it("team-total names color by line direction", () => {
    expect(outcomeSide({ name: "Arsenal Over 1.5", home: "Arsenal", away: "Chelsea" })).toBe("first");
    expect(outcomeSide({ name: "Arsenal Under 1.5", home: "Arsenal", away: "Chelsea" })).toBe("second");
  });
  it("Yes/No BTTS and Odd/Even parity", () => {
    expect(outcomeSide({ name: "Yes" })).toBe("first");
    expect(outcomeSide({ name: "No" })).toBe("second");
    expect(outcomeSide({ name: "Odd" })).toBe("first");
    expect(outcomeSide({ name: "Even" })).toBe("second");
  });
});

describe("isTwoWayMarket — coloring eligibility", () => {
  it("admits Goal Line / totals boards (all Over/Under lines)", () => {
    expect(isTwoWayMarket("ALTERNATE_TOTALS", ["Over 0.5", "Under 0.5", "Over 1.5", "Under 1.5"])).toBe(true);
    expect(isTwoWayMarket("OVER_UNDER", ["Over 2.5", "Under 2.5"])).toBe(true);
    expect(isTwoWayMarket("TOTAL_CORNERS", ["Over 9.5", "Under 9.5"])).toBe(true);
    expect(isTwoWayMarket("TEAM_CORNERS", ["Arsenal Over 3.5", "Arsenal Under 3.5"])).toBe(true);
  });
  it("admits BTTS Yes/No and clean 2-way boards (DNB/Asian/parity)", () => {
    expect(isTwoWayMarket("BTTS", ["Yes", "No"])).toBe(true);
    expect(isTwoWayMarket("DRAW_NO_BET", ["Ipswich Town", "Liverpool"])).toBe(true);
    expect(isTwoWayMarket("SPREAD", ["Ipswich Town -0.5", "Liverpool +0.5"])).toBe(true);
    expect(isTwoWayMarket("GOAL_ODD_EVEN", ["Odd", "Even"])).toBe(true);
  });
  it("rejects 3+-outcome boards (1X2, DC, correct score, HT/FT, props, ranges)", () => {
    expect(isTwoWayMarket("h2h", ["Ipswich Town", "Draw", "Liverpool"])).toBe(false);
    expect(isTwoWayMarket("MATCH_RESULT", ["Ipswich Town", "Draw", "Liverpool"])).toBe(false);
    expect(isTwoWayMarket("DOUBLE_CHANCE", ["1X", "12", "X2"])).toBe(false);
    expect(isTwoWayMarket("HT_FT", ["1/1", "X/X", "2/2", "1/X"])).toBe(false);
    expect(isTwoWayMarket("CORRECT_SCORE", ["2-1", "1-1", "0-3"])).toBe(false);
    expect(isTwoWayMarket("MULTI_GOALS", ["0-2", "3-4", "5+"])).toBe(false);
    expect(isTwoWayMarket("PLAYER_GOALSCORER_ANYTIME", ["Salah", "Haaland", "Kane"])).toBe(false);
  });
  it("requires at least two priced outcomes", () => {
    expect(isTwoWayMarket("BTTS", ["Yes"])).toBe(false);
    expect(isTwoWayMarket("OVER_UNDER", [])).toBe(false);
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
