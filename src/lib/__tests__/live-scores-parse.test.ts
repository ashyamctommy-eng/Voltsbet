import { describe, it, expect } from "vitest";
import { parseScoreEvent, TheOddsApi, type ScoreEvent } from "../providers/odds-api";

/**
 * State-machine contract for the live sweep (The Odds API v4 /scores):
 *  - completed === true                        → "finished"
 *  - completed === false && commence_time<=now → "live"   (even if scores:null)
 *  - completed === false && commence_time>now  → "scheduled"
 * Scores are matched by TEAM NAME against the payload's `scores` array.
 */
const NOW = Date.parse("2026-09-10T20:00:00Z");

const ev = (over: Partial<ScoreEvent>): ScoreEvent => ({
  id: "abc123",
  sport_key: "soccer_epl",
  commence_time: "2026-09-10T19:00:00Z",
  completed: false,
  home_team: "Arsenal",
  away_team: "Chelsea",
  scores: null,
  ...over,
});

describe("parseScoreEvent", () => {
  it("maps scores by team name, not array order", () => {
    const s = parseScoreEvent(
      ev({
        scores: [
          { name: "Chelsea", score: "1" },
          { name: "Arsenal", score: "3" },
        ],
      }),
      NOW,
    );
    expect(s.homeScore).toBe(3);
    expect(s.awayScore).toBe(1);
    expect(s.status).toBe("live");
  });

  it("treats a commenced game with no scores yet as LIVE (regression)", () => {
    // The API can return scores:null while a game is in play (early/0-0).
    // Commence time — not the scores array — decides live vs scheduled.
    const s = parseScoreEvent(ev({ scores: null }), NOW);
    expect(s.status).toBe("live");
    expect(s.homeScore).toBeUndefined();
  });

  it("keeps genuinely upcoming games SCHEDULED", () => {
    const s = parseScoreEvent(ev({ commence_time: "2026-09-11T19:00:00Z" }), NOW);
    expect(s.status).toBe("scheduled");
  });

  it("marks completed games FINISHED regardless of commence time", () => {
    const s = parseScoreEvent(
      ev({
        completed: true,
        scores: [
          { name: "Arsenal", score: "2" },
          { name: "Chelsea", score: "2" },
        ],
      }),
      NOW,
    );
    expect(s.status).toBe("finished");
    expect(s.homeScore).toBe(2);
    expect(s.awayScore).toBe(2);
  });
});

describe("fetchUpcomingGames in-play guard", () => {
  it("makes no API call for an empty eventIds filter", async () => {
    // No ODDS_API_KEY is set in the test env: if the provider attempted a
    // request it would throw "ODDS_API_KEY is not set". Returning [] proves
    // the empty filter short-circuits before any network/quota spend.
    delete process.env.ODDS_API_KEY;
    const games = await new TheOddsApi().fetchUpcomingGames(["upcoming"], ["h2h"], { eventIds: [] });
    expect(games).toEqual([]);
  });
});
