import { describe, it, expect } from "vitest";
import {
  BOOKING_POINTS,
  CORNER_MARKET_KEYS,
  resolveStatOutcome,
  normalizeTeamName,
  type StatContext,
} from "@/lib/settlement/resolve-stats";
import { isOrientationSwapped, pickGame, teamMatchScore } from "@/lib/settlement/match-game";

const ctx: StatContext = {
  homeName: "Racing Santander",
  awayName: "Deportivo Alaves",
  corners: { ht: { home: 2, away: 3 }, ft: { home: 6, away: 4 } },
  cards: {
    ht: { homeYellows: 1, awayYellows: 2, homeReds: 0, awayReds: 0 },
    ft: { homeYellows: 3, awayYellows: 2, homeReds: 1, awayReds: 0 },
  },
};

const resolve = (key: string, name: string, label: string | null = null, settleCards = false) =>
  resolveStatOutcome(ctx, key, name, label, { settleCards });

describe("resolveStatOutcome · TOTAL_CORNERS", () => {
  it("settles over/under off the match corner total", () => {
    expect(resolve("TOTAL_CORNERS", "Over 9.5")).toBe("WON"); // 6+4 = 10
    expect(resolve("TOTAL_CORNERS", "Under 9.5")).toBe("LOST");
    expect(resolve("TOTAL_CORNERS", "Over 10.5")).toBe("LOST");
    expect(resolve("TOTAL_CORNERS", "Under 10.5")).toBe("WON");
  });

  it("voids a whole-line push", () => {
    expect(resolve("TOTAL_CORNERS", "Over 10")).toBe("VOID");
    expect(resolve("TOTAL_CORNERS", "Under 10")).toBe("VOID");
  });

  it("refuses quarter lines (Asian half-win/half-push) and unknown names", () => {
    expect(resolve("TOTAL_CORNERS", "Over 9.75")).toBeNull();
    expect(resolve("TOTAL_CORNERS", "Over")).toBeNull();
  });

  it("refuses when a corner count is missing — never settles against null", () => {
    const partial: StatContext = { ...ctx, corners: { ht: ctx.corners.ht, ft: { home: null, away: 4 } } };
    expect(resolveStatOutcome(partial, "TOTAL_CORNERS", "Over 9.5", null)).toBeNull();
  });
});

describe("resolveStatOutcome · TEAM_CORNERS", () => {
  it("picks the side from the outcome name", () => {
    expect(resolve("TEAM_CORNERS", "Racing Santander Over 5.5")).toBe("WON"); // 6
    expect(resolve("TEAM_CORNERS", "Racing Santander Under 5.5")).toBe("LOST");
    expect(resolve("TEAM_CORNERS", "Deportivo Alaves Over 3.5")).toBe("WON"); // 4
    expect(resolve("TEAM_CORNERS", "Deportivo Alaves Over 4.5")).toBe("LOST");
  });

  it("falls back to the 1/2 label and refuses an ambiguous name", () => {
    expect(resolve("TEAM_CORNERS", "Over 5.5", "1")).toBe("WON");
    expect(resolve("TEAM_CORNERS", "Over 5.5", null)).toBeNull();
  });
});

describe("resolveStatOutcome · CORNERS_1X2 and handicap", () => {
  it("settles most corners, including the draw", () => {
    expect(resolve("CORNERS_1X2", "Racing Santander", "1")).toBe("WON"); // 6 > 4
    expect(resolve("CORNERS_1X2", "Deportivo Alaves", "2")).toBe("LOST");
    expect(resolve("CORNERS_1X2", "Draw", "X")).toBe("LOST");
  });

  it("settles corner handicaps and voids a pick'em push", () => {
    // Home 6, away 4 → home -1.5 wins, home -2.5 loses, away +2.5 wins.
    expect(resolve("CORNERS_HANDICAP", "Racing Santander -1.5")).toBe("WON");
    expect(resolve("CORNERS_HANDICAP", "Racing Santander -2.5")).toBe("LOST");
    expect(resolve("CORNERS_HANDICAP", "Deportivo Alaves +2.5")).toBe("WON");
    expect(resolve("CORNERS_HANDICAP", "Racing Santander -2")).toBe("VOID"); // 6-2 = 4
  });

  it("refuses quarter handicaps with a mixed result", () => {
    expect(resolve("CORNERS_HANDICAP", "Deportivo Alaves +1.75")).toBeNull();
  });
});

describe("resolveStatOutcome · cards are opt-in", () => {
  it("refuses every card market unless card settlement is enabled", () => {
    expect(resolve("TOTAL_BOOKINGS", "Over 4.5")).toBeNull();
    expect(resolve("CARDS_HANDICAP", "Racing Santander -0.5")).toBeNull();
  });

  it("uses the documented booking-points convention when enabled", () => {
    // Home: 3 yellows + 1 red = 3 + 2 = 5. Away: 2 yellows = 2. Total = 7.
    expect(BOOKING_POINTS).toEqual({ yellow: 1, red: 2 });
    expect(resolve("TOTAL_BOOKINGS", "Over 6.5", null, true)).toBe("WON");
    expect(resolve("TOTAL_BOOKINGS", "Under 6.5", null, true)).toBe("LOST");
    expect(resolve("CARDS_HANDICAP", "Racing Santander -2.5", null, true)).toBe("WON"); // 5 vs 2
    expect(resolve("CARDS_HANDICAP", "Deportivo Alaves +2.5", null, true)).toBe("LOST");
  });

  it("refuses cards when any count is missing", () => {
    const partial: StatContext = {
      ...ctx,
      cards: { ht: ctx.cards.ht, ft: { ...ctx.cards.ft, awayReds: null } },
    };
    expect(resolveStatOutcome(partial, "TOTAL_BOOKINGS", "Over 6.5", null, { settleCards: true })).toBeNull();
  });
});

describe("resolveStatOutcome · ownership", () => {
  it("returns null for goal markets it does not own", () => {
    expect(resolve("OVER_UNDER", "Over 2.5")).toBeNull();
    expect(resolve("h2h", "Racing Santander")).toBeNull();
  });

  it("exposes the corner market keys it owns", () => {
    expect([...CORNER_MARKET_KEYS].sort()).toEqual([
      "CORNERS_1X2",
      "CORNERS_HANDICAP",
      "TEAM_CORNERS",
      "TOTAL_CORNERS",
    ]);
  });
});

describe("normalizeTeamName", () => {
  it("strips accents, punctuation and club suffixes", () => {
    expect(normalizeTeamName("Fenerbahçe")).toBe("fenerbahce");
    expect(normalizeTeamName("Wrexham AFC")).toBe("wrexham");
    expect(normalizeTeamName("Racing Santander S.A.D.")).toBe("racing santander"); // initials dropped
  });
});

describe("team matching", () => {
  it("scores exact and near matches high, and weak ones low", () => {
    expect(teamMatchScore("Racing Santander", "Racing Santander")).toBe(1);
    expect(teamMatchScore("Wrexham AFC", "Wrexham")).toBeGreaterThanOrEqual(0.6);
    expect(teamMatchScore("Manchester United", "Manchester City")).toBeLessThan(0.6); // must NOT match
  });

  it("picks the fixture and rejects a kickoff outside tolerance", () => {
    const kickoff = new Date("2026-09-11T18:00:00Z");
    const games = [
      { id: "a", homeName: "Racing Santander", awayName: "Deportivo Alaves", startAt: kickoff },
      { id: "b", homeName: "Other", awayName: "Team", startAt: kickoff },
    ];
    const picked = pickGame(games, {
      homeName: "Racing Santander",
      awayName: "Deportivo Alaves",
      kickoff,
    });
    expect(picked?.id).toBe("a");

    const far = new Date("2026-09-11T23:00:00Z"); // +5h, outside 180min
    expect(
      pickGame([games[0]], { homeName: "Racing Santander", awayName: "Deportivo Alaves", kickoff: far }),
    ).toBeNull();
  });

  it("detects a reversed orientation so team numbers can be flipped", () => {
    const game = { homeName: "Deportivo Alaves", awayName: "Racing Santander" };
    expect(isOrientationSwapped(game, { homeName: "Racing Santander", awayName: "Deportivo Alaves" })).toBe(true);
    expect(isOrientationSwapped(game, { homeName: "Deportivo Alaves", awayName: "Racing Santander" })).toBe(false);
  });
});
