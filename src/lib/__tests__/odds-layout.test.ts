import { describe, it, expect } from "vitest";
import { pairOverUnderGroups, gridColumns } from "@/lib/odds-layout";

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

  it("groups a TEAM_CORNERS-shaped board per team (drives the sub-header)", () => {
    // Provider shape: `${description} ${stamped}` -> "West Ham United Over 9.5".
    // The sub-header path keys off a NON-EMPTY prefix, not a market-key list,
    // so TEAM_CORNERS gets team grouping for free.
    const groups = pairOverUnderGroups([
      o("West Ham United Over 9.5"),
      o("West Ham United Under 9.5"),
      o("West Ham United Over 10.5"),
      o("West Ham United Under 10.5"),
      o("Wrexham AFC Over 9.5"),
      o("Wrexham AFC Under 9.5"),
    ]);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.prefix)).toEqual([
      "West Ham United",
      "West Ham United",
      "Wrexham AFC",
    ]);
    expect(groups!.map((g) => g.cells.map((c) => c.name))).toEqual([
      ["West Ham United Over 9.5", "West Ham United Under 9.5"],
      ["West Ham United Over 10.5", "West Ham United Under 10.5"],
      ["Wrexham AFC Over 9.5", "Wrexham AFC Under 9.5"],
    ]);
  });

  it("returns a blank prefix when the rows carry no team (headerless fallback)", () => {
    const groups = pairOverUnderGroups([o("Over 9.5"), o("Under 9.5")]);
    expect(groups!.map((g) => g.prefix)).toEqual([""]);
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

describe("gridColumns", () => {
  it("lays 1X2 / Double Chance / Correct Score out three across", () => {
    expect(gridColumns(3)).toBe(3);
    expect(gridColumns(6)).toBe(3); // "1X2 & BTTS" → two rows of three
    expect(gridColumns(9)).toBe(3); // HT/FT
    expect(gridColumns(20)).toBe(3); // correct score
  });

  it("uses two columns for a pair, and for four so no row is an orphan", () => {
    expect(gridColumns(2)).toBe(2);
    expect(gridColumns(4)).toBe(2);
  });

  it("uses a single full-width column for a lone outcome", () => {
    expect(gridColumns(1)).toBe(1);
  });
});
