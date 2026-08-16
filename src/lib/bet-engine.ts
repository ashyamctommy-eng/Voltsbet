import { prisma } from "./prisma";
import { ApiError } from "./api";
import { getSettings } from "./settings";
import { isUserActionAllowed } from "./statuses";
import type { User } from "@prisma/client";

const BETTABLE_GAME_STATUSES = ["SCHEDULED", "LIVE", "HALF_TIME"];

export type BetSelectionInput = {
  outcomeId: string;
  oddsAtPlacement: number; // odds the user saw when they tapped
};

export type PlaceBetInput = {
  selections: BetSelectionInput[];
  stake: number;
  type: "SINGLE" | "MULTIPLE";
  acceptOddsChange?: boolean;
};

function betCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `VB-${s}`;
}

/**
 * Server-side bet placement. Every §54 check happens here — never trust the
 * frontend. Returns the created bet with fresh odds; throws ApiError with
 * code ODD_CHANGE (409) when odds moved and the user hasn't confirmed.
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

  // 3. Load selections + validate every betting condition
  const outcomes = await prisma.outcome.findMany({
    where: { id: { in: [...unique] } },
    include: { market: { include: { game: true } } },
  });
  if (outcomes.length !== unique.size) {
    throw new ApiError(400, "One or more selections no longer exist.", "SELECTION_GONE");
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

  // 5. Odds integrity: client odds vs current DB odds
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

  // 7. Wallet check + atomic debit
  const code = betCode();
  const bet = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
    const balance = Number(wallet.balance);
    if (balance < input.stake) {
      throw new ApiError(400, "You do not have enough funds to place this bet.", "INSUFFICIENT_BALANCE");
    }
    const newBalance = Math.round((balance - input.stake) * 100) / 100;

    const b = await tx.bet.create({
      data: {
        code,
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
              oddsAtPlacement: currentOdds.get(o.id)!.toFixed(2),
            };
          }),
        },
      },
    });

    await tx.wallet.update({
      where: { userId: user.id },
      data: { balance: newBalance.toFixed(2) },
    });
    await tx.transaction.create({
      data: {
        userId: user.id,
        type: "BET_STAKE",
        amount: (-input.stake).toFixed(2),
        currencyCode: wallet.currencyCode,
        prevBalance: balance.toFixed(2),
        newBalance: newBalance.toFixed(2),
        reason: `Bet stake ${code}`,
        reference: code,
      },
    });
    return b;
  });

  return { bet, totalOdds, potentialWin, acceptedOdds: changed.map((c) => c.outcomeId) };
}
