import { describe, it, expect } from "vitest";
import { cornerScores, resolveCornerOutcome } from "../stats/corner-settle";
import { matchFixture, normalizeTeamName, teamMatchScore } from "../stats/match";

const G = { homeCorners: 6, awayCorners: 3, homeName: "Fenerbahçe", awayName: "AS Roma" };

describe("resolveCornerOutcome · TOTAL_CORNERS", () => {
  it("settles over/under on the corner total", () => {
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Over 8.5", "Over")).toBe("WON");
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Under 8.5", "Under")).toBe("LOST");
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Over 9.5", "Over")).toBe("LOST");
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Under 9.5", "Under")).toBe("WON");
  });

  it("voids a whole-line push (9 corners with Over/Under 9)", () => {
    const push = { ...G, homeCorners: 5, awayCorners: 4 };
    expect(resolveCornerOutcome(push, "TOTAL_CORNERS", "Over 9", "Over")).toBe("VOID");
    expect(resolveCornerOutcome(push, "TOTAL_CORNERS", "Under 9", "Under")).toBe("VOID");
  });

  it("refuses quarter lines (Asian split can't be a single result)", () => {
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Over 8.75", "Over")).toBeNull();
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Under 8.25", "Under")).toBeNull();
  });

  it("refuses when the corner counts or the line are missing", () => {
    expect(resolveCornerOutcome({ ...G, homeCorners: null }, "TOTAL_CORNERS", "Over 8.5", "Over")).toBeNull();
    expect(resolveCornerOutcome(G, "TOTAL_CORNERS", "Over", "Over")).toBeNull();
  });
});

describe("resolveCornerOutcome · TEAM_CORNERS", () => {
  it("picks the side from the team name in the outcome", () => {
    expect(resolveCornerOutcome(G, "TEAM_CORNERS", "Fenerbahçe Over 4.5", null)).toBe("WON");
    expect(resolveCornerOutcome(G, "TEAM_CORNERS", "AS Roma Over 4.5", null)).toBe("LOST");
    expect(resolveCornerOutcome(G, "TEAM_CORNERS", "Roma Under 3.5", null)).toBe("WON");
  });

  it("falls back to the home/away label", () => {
    expect(resolveCornerOutcome(G, "TEAM_CORNERS", "Over 4.5", "home")).toBe("WON");
    expect(resolveCornerOutcome(G, "TEAM_CORNERS", "Over 4.5", "away")).toBe("LOST");
  });

  it("refuses when the side can't be determined", () => {
    expect(resolveCornerOutcome(G, "TEAM_CORNERS", "Over 4.5", null)).toBeNull();
  });
});

describe("resolveCornerOutcome · CORNERS_1X2", () => {
  it("settles most corners including a tie as the draw", () => {
    expect(resolveCornerOutcome(G, "CORNERS_1X2", "Fenerbahçe", "1")).toBe("WON");
    expect(resolveCornerOutcome(G, "CORNERS_1X2", "AS Roma", "2")).toBe("LOST");
    expect(resolveCornerOutcome(G, "CORNERS_1X2", "Draw", "X")).toBe("LOST");
    const tie = { ...G, homeCorners: 4, awayCorners: 4 };
    expect(resolveCornerOutcome(tie, "CORNERS_1X2", "Draw", "X")).toBe("WON");
  });

  it("refuses a stale (1X2-style) outcome name with no usable side", () => {
    expect(resolveCornerOutcome(G, "CORNERS_1X2", "Home", null)).toBeNull();
  });
});

describe("resolveCornerOutcome · CORNERS_HANDICAP", () => {
  it("settles a clean handicap on the corner difference", () => {
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "Fenerbahçe -1.5", "1")).toBe("WON");
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "Fenerbahçe -3.5", "1")).toBe("LOST");
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "AS Roma +1.5", "2")).toBe("LOST");
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "AS Roma +3.5", "2")).toBe("WON");
  });

  it("voids a whole-line push", () => {
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "Fenerbahçe -3", "1")).toBe("VOID");
  });

  it("returns a quarter line when BOTH halves agree (equivalent to a clean bet)", () => {
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "Fenerbahçe -1.75", "1")).toBe("WON");
  });

  it("refuses a quarter line whose halves disagree (half-win / half-push)", () => {
    // diff = 2 corners: −2.25 splits into −2 (push) and −2.5 (lost) → not expressible
    const two = { ...G, homeCorners: 5, awayCorners: 3 };
    expect(resolveCornerOutcome(two, "CORNERS_HANDICAP", "Fenerbahçe -2.25", "1")).toBeNull();
    expect(resolveCornerOutcome(two, "CORNERS_HANDICAP", "Fenerbahçe -1.75", "1")).toBeNull();
  });

  it("refuses when the backed side or line is unreadable", () => {
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "Fenerbahçe", "1")).toBeNull();
    expect(resolveCornerOutcome(G, "CORNERS_HANDICAP", "-1.5", null)).toBeNull();
  });
});

describe("resolveCornerOutcome · deliberate refusals", () => {
  it("never settles cards (booking conventions differ)", () => {
    expect(resolveCornerOutcome(G, "TOTAL_BOOKINGS", "Over 4.5", "Over")).toBeNull();
    expect(resolveCornerOutcome(G, "CARDS_HANDICAP", "Fenerbahçe -1.5", "1")).toBeNull();
  });

  it("never settles an unknown market", () => {
    expect(resolveCornerOutcome(G, "MATCH_RESULT", "Fenerbahçe", "1")).toBeNull();
  });
});

describe("cornerScores · orientation", () => {
  const stats = [
    { team: "AS Roma", corners: 3 },
    { team: "Fenerbahçe", corners: 6 },
  ];

  it("maps feed rows onto our home/away regardless of order", () => {
    expect(cornerScores(stats, { homeName: "Fenerbahce", awayName: "Roma" })).toEqual({ homeCorners: 6, awayCorners: 3 });
  });

  it("returns null when nothing matches (never guesses the sides)", () => {
    expect(cornerScores([{ team: "Chelsea", corners: 5 }], { homeName: "Arsenal", awayName: "Roma" })).toBeNull();
  });

  it("keeps a one-sided result as null on the unknown side", () => {
    const partial = cornerScores([{ team: "Fenerbahçe", corners: 6 }], { homeName: "Fenerbahce", awayName: "Roma" });
    expect(partial).toEqual({ homeCorners: 6, awayCorners: null });
    // …and a total-corner market therefore stays unsettled
    expect(resolveCornerOutcome({ ...partial!, homeName: "Fenerbahce", awayName: "Roma" }, "TOTAL_CORNERS", "Over 8.5", "Over")).toBeNull();
  });
});

describe("fixture matching (the two id spaces)", () => {
  const kickoff = "2026-09-10T19:00:00Z";

  it("normalizes accents and club noise words", () => {
    expect(normalizeTeamName("Fenerbahçe")).toBe("fenerbahce");
    expect(normalizeTeamName("AS Roma")).toBe("roma");
    expect(normalizeTeamName("Arsenal FC")).toBe("arsenal");
    expect(teamMatchScore("Fenerbahçe", "Fenerbahce")).toBe(2);
    expect(teamMatchScore("AS Roma", "Roma")).toBe(2);
    expect(teamMatchScore("Manchester United", "Manchester City")).toBeGreaterThan(0); // shares "manchester"
  });

  it("matches on names + kickoff", () => {
    const fixtures = [
      { fixtureId: 1, homeName: "Fenerbahce", awayName: "Roma", date: kickoff },
      { fixtureId: 2, homeName: "Bayern Munich", awayName: "Como", date: "2026-09-10T18:45:00Z" },
    ];
    const got = matchFixture({ homeName: "Fenerbahçe", awayName: "AS Roma", startAt: "2026-09-10T19:00:00Z" }, fixtures);
    expect(got?.fixtureId).toBe(1);
  });

  it("rejects a fixture whose kickoff is far away (rematch protection)", () => {
    const fixtures = [{ fixtureId: 9, homeName: "Fenerbahce", awayName: "Roma", date: "2026-11-25T20:00:00Z" }];
    expect(matchFixture({ homeName: "Fenerbahçe", awayName: "AS Roma", startAt: kickoff }, fixtures)).toBeNull();
  });

  it("rejects when either side doesn't look like the same team", () => {
    const fixtures = [{ fixtureId: 3, homeName: "Fenerbahce", awayName: "Lazio", date: kickoff }];
    expect(matchFixture({ homeName: "Fenerbahçe", awayName: "AS Roma", startAt: kickoff }, fixtures)).toBeNull();
  });

  it("returns null on an invalid date instead of matching something random", () => {
    const fixtures = [{ fixtureId: 4, homeName: "Fenerbahce", awayName: "Roma", date: kickoff }];
    expect(matchFixture({ homeName: "Fenerbahçe", awayName: "AS Roma", startAt: "nonsense" }, fixtures)).toBeNull();
  });
});
