import { describe, it, expect } from "vitest";
import { parseFixture, parseStatistics, parseTeamStats } from "../stats/api-football";
import { budgetAllows, budgetDateKey, budgetNeedsReset } from "../stats/budget";

/**
 * Parsers are exercised against REAL API-Football payloads captured on
 * 2026-09-10 with the free key (Fenerbahçe vs AS Roma, UCL, fixture 1635659),
 * so a provider field rename shows up here instead of in the settlement path.
 */

const FIXTURE_PAYLOAD = {
  errors: [],
  response: [
    {
      fixture: { id: 1635659, status: { short: "FT", elapsed: 90, extra: null } },
      teams: { home: { name: "Fenerbahçe" }, away: { name: "AS Roma" } },
      score: {
        halftime: { home: 0, away: 1 },
        fulltime: { home: 1, away: 1 },
        extratime: { home: null, away: null },
        penalty: { home: null, away: null },
      },
    },
  ],
};

const STATS_PAYLOAD = {
  errors: [],
  response: [
    {
      team: { name: "Fenerbahçe" },
      statistics: [
        { type: "Shots on Goal", value: 5 },
        { type: "Total Shots", value: 11 },
        { type: "Ball Possession", value: "42%" },
        { type: "Yellow Cards", value: 4 },
        { type: "Red Cards", value: 0 },
        { type: "Corner Kicks", value: 1 },
      ],
    },
    {
      team: { name: "AS Roma" },
      statistics: [
        { type: "Ball Possession", value: "58%" },
        { type: "Yellow Cards", value: 2 },
        { type: "Red Cards", value: 0 },
        { type: "Corner Kicks", value: 3 },
      ],
    },
  ],
};

describe("parseFixture (real payload)", () => {
  it("reads status, half-time and full-time scores", () => {
    const f = parseFixture(FIXTURE_PAYLOAD);
    expect(f).not.toBeNull();
    expect(f!.fixtureId).toBe(1635659);
    expect(f!.status).toBe("FT");
    expect(f!.elapsed).toBe(90);
    expect(f!.homeName).toBe("Fenerbahçe");
    expect(f!.halftime).toEqual({ home: 0, away: 1 }); // ← settles the `needs HT` markets
    expect(f!.fulltime).toEqual({ home: 1, away: 1 });
    expect(f!.extratime).toEqual({ home: null, away: null });
    expect(f!.penalty).toEqual({ home: null, away: null });
  });

  it("flags knockout finishes via the status code", () => {
    const aet = parseFixture({ response: [{ ...FIXTURE_PAYLOAD.response[0], fixture: { id: 1, status: { short: "AET" } } }] });
    const pen = parseFixture({ response: [{ ...FIXTURE_PAYLOAD.response[0], fixture: { id: 2, status: { short: "PEN" } } }] });
    expect(aet!.status).toBe("AET");
    expect(pen!.status).toBe("PEN");
  });

  it("returns null for an empty/garbage payload", () => {
    expect(parseFixture({ response: [] })).toBeNull();
    expect(parseFixture(null)).toBeNull();
  });
});

describe("parseStatistics (real payload)", () => {
  it("extracts corners, cards and possession per team", () => {
    const rows = parseStatistics(STATS_PAYLOAD);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ team: "Fenerbahçe", corners: 1, yellow: 4, red: 0, possession: 42 });
    expect(rows[1]).toEqual({ team: "AS Roma", corners: 3, yellow: 2, red: 0, possession: 58 });
  });

  it("tolerates missing stat types (returns null, never throws)", () => {
    const t = parseTeamStats({ team: { name: "X" }, statistics: [{ type: "Corner Kicks", value: 7 }] });
    expect(t).toEqual({ team: "X", corners: 7, yellow: null, red: null, possession: null });
  });

  it("returns [] when the provider has no stats yet (live match)", () => {
    expect(parseStatistics({ response: [] })).toEqual([]);
    expect(parseStatistics(undefined)).toEqual([]);
  });
});

describe("stats budget guard", () => {
  it("keys the counter to the UTC day (free tier resets 00:00 UTC)", () => {
    expect(budgetDateKey(new Date("2026-09-10T23:59:00Z"))).toBe("2026-09-10");
    expect(budgetDateKey(new Date("2026-09-11T00:01:00Z"))).toBe("2026-09-11");
  });

  it("allows while there is headroom and refuses when spent", () => {
    expect(budgetAllows(0, 90)).toBe(true);
    expect(budgetAllows(89, 90)).toBe(true);
    expect(budgetAllows(90, 90)).toBe(false);
    expect(budgetAllows(90, 90, 2)).toBe(false);
  });

  it("treats a 0 budget as disabled (never silently spends)", () => {
    expect(budgetAllows(0, 0)).toBe(false);
  });

  it("resets on a new day", () => {
    expect(budgetNeedsReset("2026-09-09", "2026-09-10")).toBe(true);
    expect(budgetNeedsReset("2026-09-10", "2026-09-10")).toBe(false);
    expect(budgetNeedsReset(null, "2026-09-10")).toBe(false);
  });
});
