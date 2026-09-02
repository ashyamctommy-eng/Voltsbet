import { describe, it, expect } from "vitest";
import { stampPointName } from "@/lib/providers/odds-api";

/**
 * The Odds API v4 (eu books: bovada/pinnacle) serves line markets with the
 * line in the outcome `point` field and a bare name ("Over" / team name).
 * Without stamping, every Goal-Line/alternate-spread outcome would be stored
 * as an identical duplicate name and lines would be lost. These cases pin the
 * name conventions the settlement engine + bet slip parse.
 */

describe("stampPointName — totals family", () => {
  it("stamps Over/Under with the point line", () => {
    expect(stampPointName("ALTERNATE_TOTALS", "Over", 2.5)).toBe("Over 2.5");
    expect(stampPointName("ALTERNATE_TOTALS", "Under", 3.25)).toBe("Under 3.25");
    expect(stampPointName("OVER_UNDER_1H", "Over", 0.5)).toBe("Over 0.5");
    expect(stampPointName("TOTAL_CORNERS", "Under", 9.5)).toBe("Under 9.5");
    expect(stampPointName("TOTAL_BOOKINGS", "Over", 5)).toBe("Over 5"); // integer stays int
  });

  it("case-insensitive side detection keeps the display casing", () => {
    expect(stampPointName("ALTERNATE_TOTALS", "OVER", 2.5)).toBe("Over 2.5");
    expect(stampPointName("ALTERNATE_TOTALS", "under", 2.5)).toBe("Under 2.5");
  });
});

describe("stampPointName — spread family", () => {
  it("keeps the team and adds the signed line", () => {
    expect(stampPointName("ALTERNATE_SPREAD", "Ipswich Town", -0.5)).toBe("Ipswich Town -0.5");
    expect(stampPointName("SPREAD", "Ipswich Town", 1.25)).toBe("Ipswich Town +1.25");
    expect(stampPointName("CORNERS_HANDICAP", "Liverpool", -4.5)).toBe("Liverpool -4.5");
  });

  it("prints a pick'em line bare", () => {
    expect(stampPointName("SPREAD", "Ipswich Town", 0)).toBe("Ipswich Town 0");
  });
});

describe("stampPointName — pass-through", () => {
  it("leaves markets without lines untouched", () => {
    expect(stampPointName("MATCH_RESULT", "Ipswich Town", undefined)).toBe("Ipswich Town");
    expect(stampPointName("CORRECT_SCORE", "Ipswich Town:1|Liverpool:0", undefined)).toBe(
      "Ipswich Town:1|Liverpool:0"
    );
    expect(stampPointName("DOUBLE_CHANCE", "Ipswich Town or Draw", null)).toBe("Ipswich Town or Draw");
  });

  it("leaves names unchanged when point is absent or unusable", () => {
    expect(stampPointName("ALTERNATE_TOTALS", "Over", undefined)).toBe("Over");
    expect(stampPointName("ALTERNATE_TOTALS", "Over", null)).toBe("Over");
    expect(stampPointName("ALTERNATE_TOTALS", "Over 2.5", 2.5)).toBe("Over 2.5"); // already stamped
  });
});
