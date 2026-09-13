import { describe, expect, it, vi, beforeEach } from "vitest";

// The purge runs against production data, so its SAFETY RULES are the thing
// worth testing. Prisma and settings are stubbed so the rules can be exercised
// without a database: a wrong rule here deletes inventory or a customer's bet.
const findManyGame = vi.fn();
const findManySport = vi.fn();
const findManySelection = vi.fn();
const groupByGame = vi.fn();
const deleteManyGame = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sport: { findMany: (...a: unknown[]) => findManySport(...a) },
    game: {
      findMany: (...a: unknown[]) => findManyGame(...a),
      groupBy: (...a: unknown[]) => groupByGame(...a),
      deleteMany: (...a: unknown[]) => deleteManyGame(...a),
    },
    betSelection: { findMany: (...a: unknown[]) => findManySelection(...a) },
  },
}));

vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({ oddsSyncLeagues: [...WHITELIST] })),
}));

vi.mock("@/lib/sync", () => ({
  resolveSportSlug: (key: string) => (key.startsWith("soccer_") ? "football" : key.split("_")[0]),
}));

let WHITELIST: string[] = ["soccer_epl", "soccer_spain_la_liga"];

const { planUnofferedPurge, executeUnofferedPurge } = await import("@/lib/unoffered-purge");

const SPORTS = [
  { id: "s-football", slug: "football", name: "Football" },
  { id: "s-basket", slug: "basketball", name: "Basketball" },
  { id: "s-hockey", slug: "ice-hockey", name: "Ice Hockey" },
];

const game = (id: string, sportId: string) => ({
  id,
  homeName: `H${id}`,
  awayName: `A${id}`,
  startAt: new Date("2026-12-01T18:00:00Z"),
  sport: SPORTS.find((s) => s.id === sportId)!,
});

beforeEach(() => {
  WHITELIST = ["soccer_epl", "soccer_spain_la_liga"];
  findManySport.mockReset().mockResolvedValue(SPORTS);
  findManyGame.mockReset().mockResolvedValue([]);
  findManySelection.mockReset().mockResolvedValue([]);
  groupByGame.mockReset().mockResolvedValue([]);
  deleteManyGame.mockReset().mockResolvedValue({ count: 0 });
});

describe("planUnofferedPurge — safety rules", () => {
  it("REFUSES when no whitelist is saved (catalog mode means every sport is offered)", async () => {
    WHITELIST = [];
    const plan = await planUnofferedPurge();
    expect(plan.refused?.reason).toMatch(/catalog mode/i);
    expect(plan.total).toBe(0);
    // and it must not even query for candidates
    expect(findManyGame).not.toHaveBeenCalled();
  });

  it("keeps the offered sports and reports their fixture counts", async () => {
    findManyGame.mockResolvedValue([]);
    groupByGame.mockResolvedValue([{ sportId: "s-football", _count: { _all: 421 } }]);
    const plan = await planUnofferedPurge();
    expect(plan.offeredSports.map((o) => o.slug)).toEqual(["football"]);
    expect(plan.offeredSports[0].games).toBe(421);
    expect(plan.total).toBe(0);
  });

  it("only ever asks for upcoming API games in non-offered sports, excluding started ones", async () => {
    findManyGame.mockResolvedValue([]);
    await planUnofferedPurge();
    const where = findManyGame.mock.calls[0][0].where;
    expect(where.source).toBe("API"); // never touches operator-created rows
    expect(where.startAt.gt).toBeInstanceOf(Date); // upcoming only
    expect(where.status.notIn).toContain("LIVE");
    expect(where.status.notIn).toContain("FINISHED");
    expect(where.status.notIn).toContain("HALF_TIME");
    expect(where.sportId.notIn).toContain("s-football"); // offered sports are protected
  });

  it("excludes games a customer has bet on and reports the count", async () => {
    findManyGame.mockResolvedValue([game("g1", "s-basket"), game("g2", "s-basket"), game("g3", "s-hockey")]);
    findManySelection.mockResolvedValue([{ gameId: "g2" }]);
    const plan = await planUnofferedPurge();
    expect(plan.protectedCount).toBe(1);
    expect(plan.total).toBe(2); // g2 withheld
    expect(plan.counts.map((c) => `${c.slug}:${c.games}`)).toEqual(["basketball:1", "ice-hockey:1"]); // g2 withheld
    expect(plan.sample.length).toBe(2);
  });

  it("does not query selections when there are no candidates", async () => {
    findManyGame.mockResolvedValue([]);
    await planUnofferedPurge();
    expect(findManySelection).not.toHaveBeenCalled();
  });
});

describe("executeUnofferedPurge", () => {
  it("does nothing when the plan is refused", async () => {
    WHITELIST = [];
    const res = await executeUnofferedPurge();
    expect(res.deleted).toBe(0);
    expect(deleteManyGame).not.toHaveBeenCalled();
  });

  it("never hands a game with a bet selection to deleteMany", async () => {
    findManyGame.mockResolvedValue([game("g1", "s-basket")]);
    // plan() sees nothing protected; the execute pass sees the bet and must
    // withhold it anyway (belt and braces over the DB's Restrict)
    findManySelection
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ gameId: "g1" }]);
    deleteManyGame.mockResolvedValue({ count: 0 });
    await executeUnofferedPurge();
    const ids = deleteManyGame.mock.calls[0][0].where.id.in;
    expect(ids).not.toContain("g1");
  });

  it("deletes only the deletable ids", async () => {
    findManyGame.mockResolvedValue([game("g1", "s-basket"), game("g2", "s-hockey")]);
    findManySelection.mockResolvedValue([]);
    deleteManyGame.mockResolvedValue({ count: 2 });
    const res = await executeUnofferedPurge();
    expect(res.deleted).toBe(2);
    expect(deleteManyGame.mock.calls[0][0].where.id.in.sort()).toEqual(["g1", "g2"]);
  });
});
