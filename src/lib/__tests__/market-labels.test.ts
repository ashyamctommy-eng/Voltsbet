import { describe, it, expect } from "vitest";
import {
  displayOutcomeName,
  stripTeamPrefix,
  TEAM_MARKET_SCOPE,
} from "@/lib/market-labels";

const HOME = "West Ham United";
const AWAY = "Wrexham AFC";

/**
 * Team totals carry the team name inside every outcome ("West Ham United
 * Over 0.5"). Under a "Home Team Totals" / "Away Team Totals" accordion the
 * header already says which team, so the prefix is redundant — it stole the
 * width and ellipsised the label to "West Ham Unit…", hiding the line.
 */
describe("stripTeamPrefix", () => {
  it("drops a leading home team name", () => {
    expect(stripTeamPrefix("West Ham United Over 0.5", HOME, AWAY)).toBe("Over 0.5");
  });

  it("drops a leading away team name", () => {
    expect(stripTeamPrefix("Wrexham AFC Under 1.5", HOME, AWAY)).toBe("Under 1.5");
  });

  it("is case-insensitive and tolerates a leftover separator", () => {
    expect(stripTeamPrefix("west ham united - Over 2.5", HOME, AWAY)).toBe("Over 2.5");
    expect(stripTeamPrefix("Wrexham AFC: Under 3.5", HOME, AWAY)).toBe("Under 3.5");
  });

  it("leaves names with no team prefix untouched", () => {
    expect(stripTeamPrefix("Over 0.5", HOME, AWAY)).toBe("Over 0.5");
    expect(stripTeamPrefix("Yes", HOME, AWAY)).toBe("Yes");
  });

  it("never strips a label down to nothing", () => {
    expect(stripTeamPrefix(HOME, HOME, AWAY)).toBe(HOME);
  });

  it("ignores very short team names (guard against 1-2 char tokens)", () => {
    expect(stripTeamPrefix("Over 0.5", "FC", AWAY)).toBe("Over 0.5");
  });
});

describe("displayOutcomeName — team-scoped boards", () => {
  it("strips the team on Home/Away Team Totals", () => {
    expect(displayOutcomeName("West Ham United Over 0.5", "TEAM_TOTALS_HOME", HOME, AWAY)).toBe("Over 0.5");
    expect(displayOutcomeName("Wrexham AFC Under 3.5", "TEAM_TOTALS_AWAY", HOME, AWAY)).toBe("Under 3.5");
  });

  it("leaves a legacy prefix-less row alone (does not re-add the team)", () => {
    expect(displayOutcomeName("Over 0.5", "TEAM_TOTALS_HOME", HOME, AWAY)).toBe("Over 0.5");
  });

  it("does NOT strip on a mixed board where both teams share the accordion", () => {
    // "Team Totals" shows both teams in one list — the name is the only thing
    // telling the rows apart, so it must stay.
    expect(displayOutcomeName("West Ham United Over 0.5", "TEAM_TOTALS", HOME, AWAY)).toBe(
      "West Ham United Over 0.5",
    );
  });

  it("passes ordinary markets through untouched", () => {
    expect(displayOutcomeName("Over 2.5", "OVER_UNDER", HOME, AWAY)).toBe("Over 2.5");
    expect(displayOutcomeName("Draw", "h2h", HOME, AWAY)).toBe("Draw");
  });

  it("still prefixes legacy team-scoped rows that lack the team", () => {
    expect(displayOutcomeName("Over 1.5", "TEAM_TOTALS_1H", HOME, AWAY)).toBe("West Ham United Over 1.5");
  });
});

describe("TEAM_MARKET_SCOPE", () => {
  it("covers the two single-team totals boards", () => {
    expect(TEAM_MARKET_SCOPE.TEAM_TOTALS_HOME).toBe("home");
    expect(TEAM_MARKET_SCOPE.TEAM_TOTALS_AWAY).toBe("away");
    expect(TEAM_MARKET_SCOPE.TEAM_TOTALS).toBeUndefined();
  });
});
