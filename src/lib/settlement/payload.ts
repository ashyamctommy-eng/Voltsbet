/**
 * Wire format for the settlement worker → Railway webhook.
 *
 * Validated with zod at the edge so a malformed or hostile payload is rejected
 * before it can touch a bet. Everything is nullable on purpose: a scraper that
 * could not read a statistic MUST send `null` rather than 0 or omitting the
 * field, and the resolvers then refuse to settle that market (admin review)
 * instead of silently paying the wrong side.
 */
import { z } from "zod";
import type { CardCounts, SideCounts, StatContext } from "./resolve-stats";

const count = z.number().int().min(0).max(999).nullable();

const sideSchema = z.object({ home: count, away: count });

const cardSchema = z.object({
  homeYellows: count,
  awayYellows: count,
  homeReds: count,
  awayReds: count,
});

export const settlementPayloadSchema = z.object({
  /** Idempotency key — unique per match+revision. Replays are detected on it. */
  eventId: z.string().min(8).max(128),
  source: z.string().max(64).optional(),
  match: z.object({
    /** Our Game.id when the worker was told it; otherwise resolved by name+kickoff. */
    gameId: z.string().max(64).optional(),
    externalId: z.string().max(128).optional(),
    kickoff: z.string().min(10).max(40), // ISO 8601
    homeName: z.string().min(1).max(120),
    awayName: z.string().min(1).max(120),
    /** FINISHED | AET | PENS — anything else is treated as not-final. */
    status: z.string().max(16).optional(),
  }),
  stats: z.object({
    corners: z.object({ ht: sideSchema, ft: sideSchema }),
    goals: z.object({ ht: sideSchema, ft: sideSchema }),
    cards: z.object({ ht: cardSchema, ft: cardSchema }),
  }),
  meta: z
    .object({
      scrapedAt: z.string().max(40).optional(),
      url: z.string().max(500).optional(),
    })
    .optional(),
});

export type SettlementPayload = z.infer<typeof settlementPayloadSchema>;

/** Build the pure resolver context from a validated payload. */
export function toStatContext(payload: SettlementPayload): StatContext {
  const side = (s: { home: number | null; away: number | null }): SideCounts => ({
    home: s.home,
    away: s.away,
  });
  const cards = (c: {
    homeYellows: number | null;
    awayYellows: number | null;
    homeReds: number | null;
    awayReds: number | null;
  }): CardCounts => ({ ...c });

  return {
    homeName: payload.match.homeName,
    awayName: payload.match.awayName,
    corners: { ht: side(payload.stats.corners.ht), ft: side(payload.stats.corners.ft) },
    cards: { ht: cards(payload.stats.cards.ht), ft: cards(payload.stats.cards.ft) },
  };
}
