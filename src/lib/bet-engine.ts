import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./api";
import { getSettings } from "./settings";
import { isUserActionAllowed } from "./statuses";
import { debitWallet } from "./wallet";
import type { User } from "@prisma/client";

const BETTABLE_GAME_STATUSES = ["SCHEDULED", "LIVE", "HALF_TIME"];

export { BET_CANCEL_WINDOW_MS } from "./bet-cancel";

export type BetSelectionInput = {
  outcomeId: string;
  oddsAtPlacement: number; // odds the user saw when they tapped
};

export type PlaceBetInput = {
  selections: BetSelectionInput[];
  stake: number;
  type: "SINGLE" | "MULTIPLE";
  acceptOddsChange?: boolean;
  /** Client-generated idempotency key — replays return the original bet. */
  idempotencyKey?: string;
};

const BET_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BET_CODE_LEN = 6;
const MAX_CODE_ATTEMPTS = 5;

function betCode(): string {
  let s = "";
  for (let i = 0; i < BET_CODE_LEN; i++) {
    s += BET_CODE_CHARS[Math.floor(Math.random() * BET_CODE_CHARS.length)];
  }
  return `VB-${s}`;
}

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Server-side bet placement. Every §54 check happens here — never trust the
 * frontend. Returns the created bet with fresh odds; throws ApiError with
 * code ODD_CHANGE (409) when odds moved and the user hasn't confirmed.
 *
 * Race-safety: ALL validation (game/market/outcome state, odds integrity,
 * payout + liability caps) runs INSIDE the transaction against fresh reads.
 * The involved Market rows are locked (SELECT … FOR UPDATE) so concurrent
 * placements on the same market serialize — no check-then-act window. The
 * wallet debit is an atomic `balance >= stake` guard.
 */
export async function placeBet(user: User, input: PlaceBetInput) {
  const settings = await getSettings();

  // 1. Account allowed to bet?
  if (!(await isUserActionAllowed(user.status, "bet"))) {
    throw new ApiError(403, "Betting is currently disabled for your account.", "BETTING_LOCKED");
  }

  // 2. Input sanity
  const unique = new Set(input.selections.map((s) => s.outcomeId));
  if (unique.size !== input.selections.length) {
    throw new ApiError(400, "Duplicate selections in bet slip.", "DUPLICATE_SELECTION");
  }
  if (input.selections.length === 0) throw new ApiError(400, "No selections.", "EMPTY_SLIP");
  if (input.type === "MULTIPLE" && input.selections.length < 2) {
    throw new ApiError(400, "An accumulator needs at least 2 selections.", "TOO_FEW_SELECTIONS");
  }
  if (!(input.stake > 0) || !Number.isFinite(input.stake)) {
    throw new ApiError(400, "Enter a valid stake.", "INVALID_STAKE");
  }
  if (input.stake < settings.minStake) {
    throw new ApiError(400, `Minimum stake is ${settings.minStake}.`, "STAKE_TOO_LOW");
  }
  if (input.stake > settings.maxStake) {
    throw new ApiError(400, `Maximum stake is ${settings.maxStake}.`, "STAKE_TOO_HIGH");
  }

  // 2b. Idempotent replay: the same key always returns the original bet (the
  // client retries the same submission after a network blip, or a double
  // click fires twice) instead of placing a second bet.
  const replayBet = async (key: string) => {
    const existing = await prisma.bet.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.userId !== user.id) {
        throw new ApiError(400, "Invalid request key.", "BAD_IDEMPOTENCY_KEY");
      }
      return {
        bet: existing,
        totalOdds: Number(existing.totalOdds),
        potentialWin: Number(existing.potentialWin),
        acceptedOdds: [],
        replayed: true,
      };
    }
    return null;
  };
  if (input.idempotencyKey) {
    const replay = await replayBet(input.idempotencyKey);
    if (replay) return replay;
  }

  // 3. Place + validate inside one transaction (fresh reads, row locks,
  //    atomic debit, retry on bet-code collision).
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Fresh view of the selections inside the tx — the authoritative one.
        const outcomes = await tx.outcome.findMany({
          where: { id: { in: [...unique] } },
          include: { market: { include: { game: true } } },
        });
        if (outcomes.length !== unique.size) {
          throw new ApiError(400, "One or more selections no longer exist.", "SELECTION_GONE");
        }

        // Lock every involved market row so concurrent placements on the same
        // market serialize (Postgres + MySQL). This closes the exposure-cap
        // and settle-vs-place races.
        const marketIds = [...new Set(outcomes.map((o) => o.marketId))];
        if (marketIds.length > 0) {
          await tx.$queryRaw`SELECT id FROM "Market" WHERE id IN (${Prisma.join(marketIds)}) FOR UPDATE`;
        }

        for (const o of outcomes) {
          const { market } = o;
          const game = market.game;
          if (!BETTABLE_GAME_STATUSES.includes(game.status)) {
            throw new ApiError(409, `Betting is closed for ${game.homeName} vs ${game.awayName}.`, "GAME_CLOSED");
          }
          if (market.status !== "OPEN") {
            throw new ApiError(409, `Market "${market.name}" is currently ${market.status.toLowerCase()}.`, "MARKET_SUSPENDED");
          }
          if (o.status !== "ACTIVE") {
            throw new ApiError(409, `Selection "${o.name}" is currently suspended.`, "SELECTION_SUSPENDED");
          }
          if (o.settled) {
            throw new ApiError(409, `Selection "${o.name}" has already been settled.`, "SELECTION_SETTLED");
          }
        }

        // 4. Multiples must be across different games
        if (input.type === "MULTIPLE") {
          const gameIds = new Set(outcomes.map((o) => o.market.gameId));
          if (gameIds.size !== outcomes.length) {
            throw new ApiError(400, "An accumulator cannot contain two selections from the same match.", "SAME_GAME");
          }
        }

        // 5. Odds integrity: client odds vs current DB odds (fresh in-tx read)
        const currentOdds = new Map(outcomes.map((o) => [o.id, Number(o.odds)]));
        const changed: { outcomeId: string; name: string; oldOdds: number; newOdds: number }[] = [];
        let totalOdds = 1;
        for (const sel of input.selections) {
          const cur = currentOdds.get(sel.outcomeId)!;
          if (Math.abs(cur - sel.oddsAtPlacement) > 0.001) {
            changed.push({ outcomeId: sel.outcomeId, name: outcomes.find((o) => o.id === sel.outcomeId)!.name, oldOdds: sel.oddsAtPlacement, newOdds: cur });
          }
          totalOdds *= cur;
        }
        totalOdds = Math.round(totalOdds * 100) / 100;
        if (changed.length && !input.acceptOddsChange) {
          throw new ApiError(409, "Some odds have changed since you added them.", "ODD_CHANGE", {
            changed,
            totalOdds,
            potentialWin: Math.round(input.stake * totalOdds * 100) / 100,
          });
        }

        // 6. Payout cap
        const potentialWin = Math.round(input.stake * totalOdds * 100) / 100;
        if (potentialWin > settings.maxPayout) {
          throw new ApiError(400, `Maximum payout is ${settings.maxPayout}. Reduce your stake or selections.`, "PAYOUT_CAP");
        }

        // 6b. Liability limit per market — checked inside the tx, under the
        //     market row lock, so concurrent bets can't both pass the cap.
        if (settings.maxLiabilityPerMarket > 0) {
          const openBets = await tx.bet.findMany({
            where: {
              status: "OPEN",
              selections: { some: { outcome: { marketId: { in: marketIds } } } },
            },
            select: { potentialWin: true },
          });
          const currentExposure = openBets.reduce((acc, b) => acc + Number(b.potentialWin), 0);
          if (currentExposure + potentialWin > settings.maxLiabilityPerMarket) {
            throw new ApiError(
              400,
              `This bet would exceed the liability limit for the market (${settings.maxLiabilityPerMarket.toLocaleString()}). Reduce your stake or pick another market.`,
              "LIABILITY_CAP",
            );
          }
        }

        // 7. Wallet check + atomic debit
        const code = betCode();
        await debitWallet(tx, user.id, input.stake, {
          type: "BET_STAKE",
          reason: `Bet stake ${code}`,
          reference: code,
        });

        return await tx.bet.create({
          data: {
            code,
            idempotencyKey: input.idempotencyKey ?? null,
            userId: user.id,
            type: input.type,
            stake: input.stake.toFixed(2),
            totalOdds: totalOdds.toFixed(2),
            potentialWin: potentialWin.toFixed(2),
            status: "OPEN",
            selections: {
              create: input.selections.map((sel) => {
                const o = outcomes.find((x) => x.id === sel.outcomeId)!;
                return {
                  gameId: o.market.gameId,
                  marketId: o.marketId,
                  outcomeId: o.id,
                  marketName: o.market.name,
                  outcomeName: o.name,
                  label: o.label,
                  // Book the full-precision odds the user actually saw — not a
                  // 2dp rounding of it.
                  oddsAtPlacement: String(o.odds),
                };
              }),
            },
          },
        });
      });
    } catch (e) {
      // Bet-code collision → retry with a fresh code. Idempotency-key
      // collision (a concurrent duplicate of the SAME submission) → replay
      // the original bet instead of placing a second one.
      if (isUniqueViolation(e)) {
        const target = e.meta?.target;
        const fields = Array.isArray(target) ? target : [String(target ?? "")];
        if (fields.some((f) => String(f).includes("idempotencyKey")) && input.idempotencyKey) {
          const replay = await replayBet(input.idempotencyKey);
          if (replay) return replay;
          throw new ApiError(409, "This bet was already placed.", "DUPLICATE_BET");
        }
        if (fields.some((f) => String(f).includes("code")) && attempt < MAX_CODE_ATTEMPTS - 1) {
          lastError = e;
          continue;
        }
      }
      throw e;
    }
  }
  throw lastError;
}
