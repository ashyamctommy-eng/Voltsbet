/**
 * Settlement ingest — takes a validated worker payload and drives the money
 * path. See docs/AUTO-SETTLEMENT.md for the architecture and threat model.
 *
 * ORDER OF OPERATIONS (and why)
 *   1. Record the event (idempotency + audit) BEFORE touching anything.
 *   2. Resolve which Game the scrape refers to (two id spaces → name+kickoff).
 *   3. ONE short transaction: lock the Game row, write scores/status, upsert
 *      GameStats. Either all of the match data lands or none of it does.
 *   4. Settle, one outcome at a time, AFTER that transaction commits.
 *
 * WHY SETTLEMENT IS NOT INSIDE THE BIG TRANSACTION
 * `settleOutcome()` (src/lib/settle.ts) is already atomic and idempotent per
 * outcome: it claims `Outcome.settled false → true` and then claims
 * `Bet.status OPEN → final` before any money moves. Wrapping a loop of those
 * in an outer transaction would hold row locks across many bets, lengthen the
 * critical section and risk deadlocks — for no safety gain, because each claim
 * is already race-safe. The outer transaction owns DATA; the claims own MONEY.
 *
 * WHY A REPLAY CANNOT DOUBLE-PAY
 *   - step 3 is an idempotent upsert (same numbers → same result);
 *   - step 4's claims mean a second run finds nothing left to settle.
 * So a duplicate `eventId` is recorded and then RE-PROCESSED rather than
 * short-circuited — which also makes a crashed/half-finished run self-healing
 * when the worker retries. This is the opposite of the usual "reject
 * duplicates" reflex, and it is deliberate.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOutcome } from "@/lib/auto-settle";
import { settleOutcome, type SettleActor } from "@/lib/settle";
import { CARD_MARKET_KEYS, CORNER_MARKET_KEYS, resolveStatOutcome, type StatContext } from "./resolve-stats";
import { isOrientationSwapped, pickGame } from "./match-game";
import { toStatContext, type SettlementPayload } from "./payload";

const ACTOR: SettleActor = { id: "system", username: "settle-worker" };

/** Cap on the audit copy of the body (the sha256 is always stored whole). */
const PAYLOAD_MAX = 8000;

/** Games within this window of kickoff are candidates for name matching. */
const CANDIDATE_WINDOW_HOURS = 8;

const FINAL_STATUSES = new Set(["FINISHED", "AET", "PENS"]);
const PROTECTED_STATUSES = new Set(["CANCELLED", "POSTPONED"]);

export type IngestStatus = "PROCESSED" | "NEEDS_REVIEW" | "FAILED";

export type IngestResult = {
  eventId: string;
  duplicate: boolean;
  gameId: string | null;
  status: IngestStatus;
  teamsSwapped: boolean;
  settled: number;
  voided: number;
  skipped: number;
  review: string[];
  cardsEnabled: boolean;
  reason?: string;
};

/** Card settlement is opt-in: counting conventions differ between sources. */
export function cardsEnabled(): boolean {
  const v = (process.env.SETTLEMENT_SETTLE_CARDS ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Flip home/away on a stat context when the scraper's orientation is reversed. */
function flipContext(ctx: StatContext): StatContext {
  const flipSide = (s: { home: number | null; away: number | null }) => ({ home: s.away, away: s.home });
  const flipCards = (c: {
    homeYellows: number | null;
    awayYellows: number | null;
    homeReds: number | null;
    awayReds: number | null;
  }) => ({
    homeYellows: c.awayYellows,
    awayYellows: c.homeYellows,
    homeReds: c.awayReds,
    awayReds: c.homeReds,
  });
  return {
    homeName: ctx.homeName,
    awayName: ctx.awayName,
    corners: { ht: flipSide(ctx.corners.ht), ft: flipSide(ctx.corners.ft) },
    cards: { ht: flipCards(ctx.cards.ht), ft: flipCards(ctx.cards.ft) },
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Step 1 — record the event. Returns whether this eventId was already seen. */
async function recordEvent(payload: SettlementPayload, rawBody: string, hash: string) {
  try {
    await prisma.webhookEvent.create({
      data: {
        eventId: payload.eventId,
        source: payload.source ?? "settle-worker",
        status: "RECEIVED",
        payload: rawBody.slice(0, PAYLOAD_MAX),
        payloadHash: hash,
      },
    });
    return { duplicate: false };
  } catch (e) {
    if (isUniqueViolation(e)) return { duplicate: true };
    throw e;
  }
}

/** Step 2 — which Game is this? */
async function resolveGame(payload: SettlementPayload) {
  const { match } = payload;
  if (match.gameId) {
    const direct = await prisma.game.findUnique({ where: { id: match.gameId } });
    if (direct) return { game: direct, reason: undefined as string | undefined };
  }
  const kickoff = new Date(match.kickoff);
  if (Number.isNaN(kickoff.getTime())) return { game: null, reason: "invalid kickoff" };

  const pad = CANDIDATE_WINDOW_HOURS * 60 * 60 * 1000;
  const candidates = await prisma.game.findMany({
    where: { startAt: { gte: new Date(kickoff.getTime() - pad), lte: new Date(kickoff.getTime() + pad) } },
    select: { id: true, homeName: true, awayName: true, startAt: true },
    take: 100,
  });
  const picked = pickGame(candidates, {
    homeName: match.homeName,
    awayName: match.awayName,
    kickoff,
  });
  if (!picked) return { game: null, reason: "no fixture matched the team names + kickoff" };
  const game = await prisma.game.findUnique({ where: { id: picked.id } });
  return { game, reason: undefined as string | undefined };
}

/**
 * Ingest one settlement payload. Never throws for a "cannot settle" outcome —
 * those are reported in `review` so the admin queue can pick them up.
 */
export async function ingestSettlement(
  payload: SettlementPayload,
  rawBody: string,
  payloadHash: string,
): Promise<IngestResult> {
  const settleCards = cardsEnabled();
  const { duplicate } = await recordEvent(payload, rawBody, payloadHash);

  const base: IngestResult = {
    eventId: payload.eventId,
    duplicate,
    gameId: null,
    status: "NEEDS_REVIEW",
    teamsSwapped: false,
    settled: 0,
    voided: 0,
    skipped: 0,
    review: [],
    cardsEnabled: settleCards,
  };

  const { game, reason } = await resolveGame(payload);
  if (!game) {
    await prisma.webhookEvent
      .updateMany({ where: { eventId: payload.eventId }, data: { status: "NEEDS_REVIEW", error: reason, processedAt: new Date() } })
      .catch(() => {});
    return { ...base, status: "NEEDS_REVIEW", reason };
  }

  const swapped = isOrientationSwapped(game, payload.match);
  const rawCtx = toStatContext(payload);
  const ctx = swapped ? flipContext(rawCtx) : rawCtx;

  const goalHt = swapped
    ? { home: payload.stats.goals.ht.away, away: payload.stats.goals.ht.home }
    : { home: payload.stats.goals.ht.home, away: payload.stats.goals.ht.away };
  const goalFt = swapped
    ? { home: payload.stats.goals.ft.away, away: payload.stats.goals.ft.home }
    : { home: payload.stats.goals.ft.home, away: payload.stats.goals.ft.away };

  const payloadSaysFinal = FINAL_STATUSES.has((payload.match.status ?? "").toUpperCase());
  const goalsKnown = goalFt.home != null && goalFt.away != null;
  const canFinalise = payloadSaysFinal && goalsKnown && !PROTECTED_STATUSES.has(game.status);

  // ── Step 3: one transaction for all match DATA ──────────────────────────
  await prisma.$transaction(async (tx) => {
    // Serialise concurrent ingests for the same fixture (mirrors the row-lock
    // pattern used by placeBet in src/lib/bet-engine.ts).
    await tx.$queryRaw`SELECT id FROM "Game" WHERE id = ${game.id} FOR UPDATE`;

    await tx.game.update({
      where: { id: game.id },
      data: {
        ...(goalsKnown ? { homeScore: goalFt.home as number, awayScore: goalFt.away as number } : {}),
        ...(goalHt.home != null && goalHt.away != null
          ? { halfHomeScore: goalHt.home, halfAwayScore: goalHt.away }
          : {}),
        ...(canFinalise ? { status: "FINISHED", live: false } : {}),
      },
    });

    const statData = {
      htHomeCorners: ctx.corners.ht.home,
      htAwayCorners: ctx.corners.ht.away,
      ftHomeCorners: ctx.corners.ft.home,
      ftAwayCorners: ctx.corners.ft.away,
      htHomeYellows: ctx.cards.ht.homeYellows,
      htAwayYellows: ctx.cards.ht.awayYellows,
      ftHomeYellows: ctx.cards.ft.homeYellows,
      ftAwayYellows: ctx.cards.ft.awayYellows,
      htHomeReds: ctx.cards.ht.homeReds,
      htAwayReds: ctx.cards.ht.awayReds,
      ftHomeReds: ctx.cards.ft.homeReds,
      ftAwayReds: ctx.cards.ft.awayReds,
      source: payload.source ?? "settle-worker",
      capturedAt: new Date(),
    };
    await tx.gameStats.upsert({
      where: { gameId: game.id },
      create: { gameId: game.id, ...statData },
      update: statData,
    });
  });

  // ── Step 4: settle, one outcome at a time ───────────────────────────────
  const refreshed = await prisma.game.findUnique({ where: { id: game.id } });
  const finalised = refreshed?.status === "FINISHED" || FINAL_STATUSES.has(refreshed?.status ?? "");

  const markets = await prisma.market.findMany({
    where: { gameId: game.id },
    include: { outcomes: { where: { settled: false } } },
  });

  const review: string[] = [];
  let settled = 0;
  let voided = 0;
  let skipped = 0;

  if (!finalised) {
    // Stats are stored (useful for HT markets and the admin view) but nothing
    // is paid until the match is actually final.
    await prisma.webhookEvent.updateMany({
      where: { eventId: payload.eventId },
      data: { status: "NEEDS_REVIEW", gameId: game.id, error: "match not final — stored stats only", processedAt: new Date() },
    });
    return { ...base, gameId: game.id, teamsSwapped: swapped, status: "NEEDS_REVIEW", reason: "match not final — stored stats only" };
  }

  const scores = {
    homeScore: refreshed?.homeScore ?? 0,
    awayScore: refreshed?.awayScore ?? 0,
    homeName: refreshed?.homeName ?? game.homeName,
    awayName: refreshed?.awayName ?? game.awayName,
    halfHomeScore: refreshed?.halfHomeScore ?? null,
    halfAwayScore: refreshed?.halfAwayScore ?? null,
  };

  for (const market of markets) {
    const isCorner = CORNER_MARKET_KEYS.has(market.key);
    const isCard = CARD_MARKET_KEYS.has(market.key);
    for (const outcome of market.outcomes) {
      const result = isCorner || isCard
        ? resolveStatOutcome(ctx, market.key, outcome.name, outcome.label, { settleCards })
        : resolveOutcome(scores, market.key, outcome.name, outcome.label);

      if (!result) {
        review.push(`${market.key}:${outcome.name}`);
        skipped++;
        continue;
      }
      try {
        await settleOutcome(ACTOR, outcome.id, result);
        if (result === "VOID") voided++;
        else settled++;
      } catch {
        // Already settled by a concurrent run (or a genuine failure) — the
        // claim in settleOutcome is what protects the money, so count and go on.
        skipped++;
      }
    }
  }

  const status: IngestStatus = review.length > 0 ? "NEEDS_REVIEW" : "PROCESSED";
  await prisma.webhookEvent.updateMany({
    where: { eventId: payload.eventId },
    data: {
      status,
      gameId: game.id,
      settled,
      voided,
      skipped,
      error: review.length ? `${review.length} outcome(s) need manual review` : null,
      processedAt: new Date(),
    },
  });

  return {
    ...base,
    gameId: game.id,
    teamsSwapped: swapped,
    status,
    settled,
    voided,
    skipped,
    review: review.slice(0, 50),
  };
}
