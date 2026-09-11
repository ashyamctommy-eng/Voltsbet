import { describe, it, expect } from "vitest";
import { pairOverUnderGroups, pairOverUnderRows, isPairedBoard } from "@/lib/odds-layout";

const o = (name: string, id = name) => ({ id, name, label: null as string | null });

describe("pairOverUnderGroups", () => {
  it("pairs a plain totals board 2-up, ascending by line", () => {
    const groups = pairOverUnderGroups([
      o("Over 2.5"),
      o("Under 2.5"),
      o("Over 3.5"),
      o("Under 3.5"),
    ]);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.cells.map((c) => c.name))).toEqual([
      ["Over 2.5", "Under 2.5"],
      ["Over 3.5", "Under 3.5"],
    ]);
    expect(groups!.every((g) => g.prefix === "")).toBe(true);
  });

  it("keeps the team prefix of a mixed team board as the group label", () => {
    const groups = pairOverUnderGroups([
      o("West Ham United Over 0.5"),
      o("West Ham United Under 0.5"),
      o("Wrexham AFC Over 0.5"),
      o("Wrexham AFC Under 0.5"),
    ]);
    expect(groups!.map((g) => g.prefix)).toEqual(["West Ham United", "Wrexham AFC"]);
    expect(groups!.map((g) => g.cells.map((c) => c.name))).toEqual([
      ["West Ham United Over 0.5", "West Ham United Under 0.5"],
      ["Wrexham AFC Over 0.5", "Wrexham AFC Under 0.5"],
    ]);
  });

  it("returns null when the board is not a clean Over/Under set", () => {
    expect(pairOverUnderGroups([o("Yes"), o("No")])).toBeNull();
    expect(pairOverUnderGroups([o("Over 2.5"), o("Under 2.5"), o("Yes")])).toBeNull();
    expect(pairOverUnderGroups([])).toBeNull();
  });

  it("returns null when a line is missing its opposite side", () => {
    expect(pairOverUnderGroups([o("Over 2.5"), o("Over 3.5")])).toBeNull();
  });
});

describe("pairOverUnderRows", () => {
  it("falls back to one outcome per row for non-totals boards", () => {
    expect(pairOverUnderRows([o("Yes"), o("No")]).map((r) => r.length)).toEqual([1, 1]);
  });

  it("pairs totals boards", () => {
    expect(pairOverUnderRows([o("Over 2.5"), o("Under 2.5")])).toEqual([
      [o("Over 2.5"), o("Under 2.5")],
    ]);
  });
});

describe("isPairedBoard", () => {
  it("is true only for Over/Under sets", () => {
    expect(isPairedBoard([o("Over 0.5"), o("Under 0.5")])).toBe(true);
    expect(isPairedBoard([o("1"), o("X"), o("2")])).toBe(false);
  });
});
