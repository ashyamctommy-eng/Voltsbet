import { describe, it, expect } from "vitest";
import { MIN_TEAM_SCORE, pickGame, teamMatchScore } from "@/lib/settlement/match-game";

/**
 * Matching a scraped match onto OUR Game row. These two sides share no id — the
 * match is made on team names + kickoff — so a miss here is what leaves whole
 * market families unsettled for ever.
 *
 * The reported bug: our feed carried "FC Inter Turku" vs "VPS Vaasa", FotMob
 * carried "FC Inter Turku" vs "VPS". Token coverage divided by the LONGER name
 * scored that 0.5 and refused it, so the half-time score was never scraped and
 * every half-time market on the match became a manual job.
 */
describe("teamMatchScore", () => {
  it("matches the same club abbreviated to different lengths", () => {
    expect(teamMatchScore("VPS", "VPS Vaasa")).toBe(1);
    expect(teamMatchScore("FC Inter Turku", "Inter Turku")).toBe(1);
    expect(teamMatchScore("Wrexham AFC", "Wrexham")).toBe(1);
  });

  it("matches a genuine rename through the alias table", () => {
    expect(teamMatchScore("VPS Vaasa", "Vaasan Palloseura")).toBe(1);
  });

  it("still refuses different clubs from the same city", () => {
    expect(teamMatchScore("Manchester United", "Manchester City")).toBeLessThan(MIN_TEAM_SCORE);
    expect(teamMatchScore("Inter Turku", "Inter Milan")).toBeLessThan(MIN_TEAM_SCORE);
  });

  it("never folds a reserve, youth or women's side onto the first team", () => {
    expect(teamMatchScore("Juventus", "Juventus U19")).toBe(0);
    expect(teamMatchScore("Real Madrid", "Real Madrid B")).toBe(0);
    expect(teamMatchScore("Ajax", "Ajax Women")).toBe(0);
  });
});

describe("pickGame", () => {
  const g = (id: string, homeName: string, awayName: string, kickoff: string) => ({
    id,
    homeName,
    awayName,
    startAt: new Date(kickoff),
  });

  it("resolves the fixture the feed abbreviated", () => {
    const candidates = [g("a", "FC Inter Turku", "VPS", "2026-09-14T15:00:00Z")];
    const hit = pickGame(candidates, {
      homeName: "FC Inter Turku",
      awayName: "VPS Vaasa",
      kickoff: new Date("2026-09-14T15:00:00Z"),
    });
    expect(hit?.id).toBe("a");
  });

  it("refuses when two candidates match equally well", () => {
    const candidates = [
      g("a", "Dinamo", "Osijek", "2026-09-14T15:00:00Z"),
      g("b", "Dinamo Zagreb", "Osijek", "2026-09-14T15:00:00Z"),
    ];
    expect(
      pickGame(candidates, {
        homeName: "Dinamo",
        awayName: "Osijek",
        kickoff: new Date("2026-09-14T15:00:00Z"),
      }),
    ).toBeNull();
  });

  it("ignores a candidate outside the kickoff tolerance", () => {
    const candidates = [g("a", "FC Inter Turku", "VPS", "2026-09-11T15:00:00Z")];
    expect(
      pickGame(candidates, {
        homeName: "FC Inter Turku",
        awayName: "VPS Vaasa",
        kickoff: new Date("2026-09-14T15:00:00Z"),
      }),
    ).toBeNull();
  });
});
