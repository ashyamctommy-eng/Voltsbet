import { describe, it, expect } from "vitest";
import {
  settlementPayloadSchema,
  toStatContext,
  type SettlementPayload,
} from "@/lib/settlement/payload";

/**
 * The worker and the backend are two programs in two languages that must agree
 * on one wire format. These tests pin the exact payloads the worker can emit —
 * including the `fotmob` source added in worker/settle_worker.py — so a drifting
 * field name fails here instead of silently at settlement time.
 *
 * Real values captured from the live FotMob page for Union Berlin 1-3 Schalke 04
 * on 2026-09-11. Note the cards: 3-1 is the number BigBallsData gets wrong.
 */
const fotmobPayload: SettlementPayload = {
  eventId: "fotmob-5881169-9a1b2c3d4e5f",
  source: "settle-worker-fotmob",
  match: {
    externalId: "5881169",
    kickoff: "2026-09-11T18:30:00+00:00",
    homeName: "Union Berlin",
    awayName: "Schalke 04",
    status: "FINISHED",
  },
  stats: {
    corners: {
      ht: { home: 1, away: 5 },
      ft: { home: 4, away: 5 },
    },
    goals: {
      ht: { home: 0, away: 1 },
      ft: { home: 1, away: 3 },
    },
    cards: {
      ht: { homeYellows: 1, awayYellows: 0, homeReds: 0, awayReds: 0 },
      ft: { homeYellows: 3, awayYellows: 1, homeReds: 0, awayReds: 0 },
    },
  },
  meta: {
    scrapedAt: "2026-09-12T13:42:31+00:00",
    url: "https://www.fotmob.com/match/5881169",
  },
};

describe("settlement payload wire format", () => {
  it("accepts a complete FotMob payload", () => {
    const parsed = settlementPayloadSchema.safeParse(fotmobPayload);
    expect(parsed.success).toBe(true);
  });

  it("carries the card counts the resolver needs, undamaged", () => {
    const ctx = toStatContext(settlementPayloadSchema.parse(fotmobPayload));
    expect(ctx.corners.ft).toEqual({ home: 4, away: 5 });
    expect(ctx.corners.ht).toEqual({ home: 1, away: 5 });
    expect(ctx.cards.ft.homeYellows).toBe(3);
    expect(ctx.cards.ft.awayYellows).toBe(1);
  });

  it("accepts nulls for statistics a source could not read", () => {
    // A deferred FotMob page shell, or a SofaScore response missing its 1ST
    // block: the values must be null rather than 0, so the resolvers refuse to
    // settle instead of paying the wrong side.
    const partial = structuredClone(fotmobPayload);
    partial.stats.corners.ht = { home: null, away: null };
    partial.stats.goals.ht = { home: null, away: null };
    partial.stats.cards = {
      ht: { homeYellows: null, awayYellows: null, homeReds: null, awayReds: null },
      ft: { homeYellows: 3, awayYellows: 1, homeReds: 0, awayReds: 0 },
    };

    const parsed = settlementPayloadSchema.safeParse(partial);
    expect(parsed.success).toBe(true);
    const ctx = toStatContext(parsed.success ? parsed.data : fotmobPayload);
    expect(ctx.corners.ht).toEqual({ home: null, away: null });
    expect(ctx.cards.ft.homeYellows).toBe(3);
  });

  it("rejects a payload with no stats block", () => {
    const broken = { ...fotmobPayload } as Record<string, unknown>;
    delete broken.stats;
    expect(settlementPayloadSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a negative or absurd count", () => {
    const bad = structuredClone(fotmobPayload);
    bad.stats.corners.ft.home = -1;
    expect(settlementPayloadSchema.safeParse(bad).success).toBe(false);

    const silly = structuredClone(fotmobPayload);
    silly.stats.cards.ft.homeYellows = 1000;
    expect(settlementPayloadSchema.safeParse(silly).success).toBe(false);
  });

  it("accepts both source tags the worker can emit", () => {
    for (const source of ["settle-worker", "settle-worker-fotmob"]) {
      const p = structuredClone(fotmobPayload);
      p.source = source;
      expect(settlementPayloadSchema.safeParse(p).success).toBe(true);
    }
  });
});
