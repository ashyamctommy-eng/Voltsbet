import { describe, it, expect, vi } from "vitest";
import { resolveOutcome } from "@/lib/auto-settle";

/**
 * Auto-settle resolver coverage for the 21+ market families. Every derived
 * market must resolve deterministically from the final score (and half-time
 * scores where the market is half-dependent); anything undecidable returns
 * null so it stays for admin review — auto-settle never guesses.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/settle", () => ({ settleOutcome: async () => ({ affected: [] }) }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ settlementDelayMinutes: 10 }) }));
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, message: string, code = "ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, auditLog: async () => undefined };
});

type Game = {
  homeScore: number;
  awayScore: number;
  homeName: string;
  awayName: string;
  halfHomeScore?: number | null;
  halfAwayScore?: number | null;
};

const G = (h: number, a: number, half?: [number, number] | null): Game => ({
  homeScore: h,
  awayScore: a,
  homeName: "Arsenal",
  awayName: "Chelsea",
  halfHomeScore: half?.[0] ?? null,
  halfAwayScore: half?.[1] ?? null,
});

const R = (game: Game, marketKey: string, outcomeName: string, label: string | null = null) =>
  resolveOutcome(game, marketKey, outcomeName, label);

describe("resolveOutcome — core markets (regression)", () => {
  it("match result 1X2", () => {
    expect(R(G(2, 1), "MATCH_RESULT", "Arsenal", "1")).toBe("WON");
    expect(R(G(2, 1), "MATCH_RESULT", "Chelsea", "2")).toBe("LOST");
    expect(R(G(1, 1), "MATCH_RESULT", "Draw", "X")).toBe("WON");
  });
  it("correct score", () => {
    expect(R(G(2, 2), "CORRECT_SCORE", "2-2")).toBe("WON");
    expect(R(G(2, 1), "CORRECT_SCORE", "1-0")).toBe("LOST");
  });
});

describe("resolveOutcome — new derived families", () => {
  it("European Handicap (-1): Home −1 needs d ≥ 2, Draw needs d = 1, Away +1 needs d ≤ 0", () => {
    expect(R(G(3, 1), "EUROPEAN_HANDICAP", "Arsenal -1", "1")).toBe("WON");
    expect(R(G(2, 1), "EUROPEAN_HANDICAP", "Arsenal -1", "1")).toBe("LOST");
    expect(R(G(2, 1), "EUROPEAN_HANDICAP", "Draw", "X")).toBe("WON");
    expect(R(G(2, 2), "EUROPEAN_HANDICAP", "Draw", "X")).toBe("LOST");
    expect(R(G(1, 1), "EUROPEAN_HANDICAP", "Chelsea +1", "2")).toBe("WON");
    expect(R(G(2, 0), "EUROPEAN_HANDICAP", "Chelsea +1", "2")).toBe("LOST");
  });

  it("Win to Nil", () => {
    expect(R(G(3, 0), "WIN_TO_NIL", "Arsenal Win to Nil", "1")).toBe("WON");
    expect(R(G(3, 1), "WIN_TO_NIL", "Arsenal Win to Nil", "1")).toBe("LOST");
    expect(R(G(0, 2), "WIN_TO_NIL", "Chelsea Win to Nil", "2")).toBe("WON");
    expect(R(G(1, 1), "WIN_TO_NIL", "Neither", "X")).toBe("WON");
    expect(R(G(3, 0), "WIN_TO_NIL", "Neither", "X")).toBe("LOST");
  });

  it("Clean Sheet", () => {
    expect(R(G(2, 0), "CLEAN_SHEET", "Arsenal - Clean Sheet", "1")).toBe("WON");
    expect(R(G(2, 1), "CLEAN_SHEET", "Arsenal - Concede", "1")).toBe("WON");
    expect(R(G(0, 1), "CLEAN_SHEET", "Chelsea - Clean Sheet", "2")).toBe("WON");
    expect(R(G(0, 1), "CLEAN_SHEET", "Arsenal - Clean Sheet", "1")).toBe("LOST");
  });

  it("Multi-Goals ranges", () => {
    expect(R(G(2, 0), "MULTI_GOALS", "1-2 Goals")).toBe("WON");
    expect(R(G(1, 1), "MULTI_GOALS", "2-3 Goals")).toBe("WON");
    expect(R(G(3, 1), "MULTI_GOALS", "3-5 Goals")).toBe("WON");
    expect(R(G(4, 3), "MULTI_GOALS", "6+ Goals")).toBe("WON");
    expect(R(G(5, 0), "MULTI_GOALS", "1-2 Goals")).toBe("LOST");
  });

  it("1st Half BTTS — needs half-time score, else admin", () => {
    expect(R(G(2, 1, [1, 1]), "FIRST_HALF_BTTS", "Yes")).toBe("WON");
    expect(R(G(2, 0, [1, 0]), "FIRST_HALF_BTTS", "No")).toBe("WON");
    expect(R(G(2, 1, null), "FIRST_HALF_BTTS", "Yes")).toBeNull();
  });

  it("Highest Scoring Half — needs half-time score", () => {
    expect(R(G(2, 1, [2, 0]), "HIGHEST_SCORING_HALF", "1st Half", "1")).toBe("WON");
    expect(R(G(1, 2, [0, 1]), "HIGHEST_SCORING_HALF", "2nd Half", "2")).toBe("WON");
    expect(R(G(2, 2, [1, 1]), "HIGHEST_SCORING_HALF", "Tie", "X")).toBe("WON");
    expect(R(G(2, 1, [0, 0]), "HIGHEST_SCORING_HALF", "1st Half", "1")).toBe("LOST");
    expect(R(G(2, 1, null), "HIGHEST_SCORING_HALF", "1st Half", "1")).toBeNull();
  });

  it("Half-Time / Full-Time — 9-way, needs half-time score", () => {
    expect(R(G(2, 0, [1, 0]), "HT_FT", "1/1")).toBe("WON");
    expect(R(G(2, 2, [1, 0]), "HT_FT", "1/X")).toBe("WON");
    expect(R(G(0, 2, [0, 1]), "HT_FT", "2/2")).toBe("WON");
    expect(R(G(2, 0, [1, 0]), "HT_FT", "1/2")).toBe("LOST");
    expect(R(G(2, 0, [0, 0]), "HT_FT", "X/1")).toBe("WON");
    expect(R(G(2, 0, null), "HT_FT", "1/1")).toBeNull();
  });
});
