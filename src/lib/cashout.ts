import { prisma } from "./prisma";
import { ApiError } from "./api";
import { getSettings, type SiteSettings } from "./settings";
import { creditWallet } from "./wallet";
import type { Bet, Prisma } from "@prisma/client";

/**
 * Cash-out engine — full cash-out on OPEN bets.
 *
 * Quote: the bet is worth `stake × originalTotalOdds ÷ currentTotalOdds`
 * (its fair value given the CURRENT market prices of the remaining legs),
 * minus a book margin (`cashoutMarginPercent`). If current odds shortened,
 * the cash-out exceeds the stake (lock in profit); if they drifted out, it
 * is below stake (cut the loss).
 *
 * Race-safety: execution claims the bet OPEN → CASHED_OUT atomically inside
 * the transaction (the same guard the settlement engine uses), so a player
 * cashing out while the settlement cron settles a leg can never be paid
 * twice — exactly one actor moves the bet out of OPEN.
 */

type BetWithSelections = Bet & {
  selections: { outcomeId: string; settled: boolean; result: string | null }[];
};

export type CashOutQuote = {
  available: boolean;
  value?: number;
  reason?: string;
  currentTotalOdds?: number;
};

/** Cash-out is only offered while every leg is priced and active. */
const UNAVAILABLE = (reason: string): CashOutQuote => ({ available: false, reason });

/**
 * Compute the cash-out quote for an open bet. Read-only (no writes).
 * `s` may be passed in to avoid a second settings fetch from callers that
 * already loaded them.
 */
export async function quoteCashOut(bet: BetWithSelections, s?: SiteSettings): Promise<CashOutQuote> {
  const settings = s ?? (await getSettings());
  if (!settings.cashoutEnabled) return UNAVAILABLE("Cash-out is currently disabled.");
  if (bet.status !== "OPEN") return UNAVAILABLE("This bet is no longer open.");

  // A parlay-reduced acca has settled VOID legs — the quote covers ONLY the
  // legs still running (the void legs already reduced totalOdds).
  const liveLegs = bet.selections.filter((sel) => !sel.settled);
  if (liveLegs.length === 0) return UNAVAILABLE("All legs have settled — this bet is being settled.");
  const liveOutcomeIds = liveLegs.map((sel) => sel.outcomeId);

  const outcomes = await prisma.outcome.findMany({
    where: { id: { in: liveOutcomeIds } },
    include: { market: { include: { game: true } } },
  });
  if (outcomes.length !== liveOutcomeIds.length) return UNAVAILABLE("A selection on this bet no longer exists.");

  let currentTotalOdds = 1;
  for (const o of outcomes) {
    const odds = Number(o.odds);
    // Every running leg must still be priced and tradeable; a suspended,
    // settled or finished leg makes the bet unquotable (it is settling).
    if (!(odds > 1.01) || o.settled || o.status !== "ACTIVE" || o.market.status !== "OPEN") {
      return UNAVAILABLE("One of your selections is suspended or settling — cash-out is unavailable right now.");
    }
    if (["FINISHED", "CANCELLED", "POSTPONED"].includes(o.market.game.status)) {
      return UNAVAILABLE("A match on this bet has finished — it is settling.");
    }
    currentTotalOdds *= odds;
  }

  const stake = Number(bet.stake);
  const originalTotalOdds = Math.max(1, Number(bet.totalOdds));
  let value = (stake * originalTotalOdds) / currentTotalOdds;
  // Book margin on the quote — the player gets slightly less than fair value.
  value *= 1 - Math.min(50, Math.max(0, settings.cashoutMarginPercent)) / 100;
  value = Math.round(value * 100) / 100;
  if (!(value >= 0.01)) return UNAVAILABLE("Cash-out value is too small to offer.");

  return { available: true, value, currentTotalOdds: Math.round(currentTotalOdds * 100) / 100 };
}

/**
 * Execute a full cash-out: claim OPEN → CASHED_OUT atomically and credit the
 * quoted value. Throws when the bet is not cash-outable (already settled /
 * cashed out / cancelled, or legs suspended).
 */
export async function executeCashOut(userId: string, betId: string): Promise<{ value: number; code: string }> {
  const settings = await getSettings();
  if (!settings.cashoutEnabled) {
    throw new ApiError(403, "Cash-out is currently disabled.", "CASHOUT_DISABLED");
  }

  const bet = await prisma.bet.findFirst({
    where: { id: betId, userId },
    include: { selections: { select: { outcomeId: true, settled: true, result: true } } },
  });
  if (!bet) throw new ApiError(404, "Bet not found.", "NOT_FOUND");
  if (bet.status !== "OPEN") {
    throw new ApiError(409, "This bet is no longer open — it has already settled.", "NOT_OPEN");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Atomic claim — exactly one actor (cash-out / settle / cancel) may move
    // this bet out of OPEN. A concurrent settlement winning the race makes
    // this claim fail and the credit is never issued.
    const claimed = await tx.bet.updateMany({
      where: { id: bet.id, userId, status: "OPEN" },
      data: { status: "CASHED_OUT", settledAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ApiError(409, "This bet is no longer open — it has already settled.", "NOT_OPEN");
    }

    // Quote from FRESH prices inside the tx (odds may have moved since the
    // user saw the number on screen — they get the live quote at execution).
    const quote = await quoteCashOutTx(tx, bet, settings);
    if (!quote.available || !quote.value) {
      throw new ApiError(409, quote.reason ?? "Cash-out is unavailable right now.", "CASHOUT_UNAVAILABLE");
    }

    await creditWallet(tx, userId, quote.value, {
      type: "CASH_OUT",
      reason: `Cash out ${bet.code}`,
      reference: bet.code,
    });
    await tx.notification.create({
      data: {
        userId,
        type: "BET_RESULT",
        title: "Cash Out ✅",
        message: `Your bet ${bet.code} was cashed out for ${quote.value.toFixed(2)}.`,
      },
    });
    return { value: quote.value, code: bet.code };
  });

  return result;
}

/** Transactional twin of quoteCashOut — uses `tx` for the reads so the quote
 *  and the claim see one consistent snapshot. */
async function quoteCashOutTx(
  tx: Prisma.TransactionClient,
  bet: BetWithSelections,
  settings: SiteSettings,
): Promise<CashOutQuote> {
  const liveLegs = bet.selections.filter((sel) => !sel.settled);
  if (liveLegs.length === 0) return UNAVAILABLE("All legs have settled — this bet is being settled.");
  const liveOutcomeIds = liveLegs.map((sel) => sel.outcomeId);

  const outcomes = await tx.outcome.findMany({
    where: { id: { in: liveOutcomeIds } },
    include: { market: { include: { game: true } } },
  });
  if (outcomes.length !== liveOutcomeIds.length) return UNAVAILABLE("A selection no longer exists.");

  let currentTotalOdds = 1;
  for (const o of outcomes) {
    const odds = Number(o.odds);
    if (!(odds > 1.01) || o.settled || o.status !== "ACTIVE" || o.market.status !== "OPEN") {
      return UNAVAILABLE("One of your selections is suspended or settling — cash-out is unavailable right now.");
    }
    if (["FINISHED", "CANCELLED", "POSTPONED"].includes(o.market.game.status)) {
      return UNAVAILABLE("A match on this bet has finished — it is settling.");
    }
    currentTotalOdds *= odds;
  }

  const stake = Number(bet.stake);
  const originalTotalOdds = Math.max(1, Number(bet.totalOdds));
  let value = (stake * originalTotalOdds) / currentTotalOdds;
  value *= 1 - Math.min(50, Math.max(0, settings.cashoutMarginPercent)) / 100;
  value = Math.round(value * 100) / 100;
  if (!(value >= 0.01)) return UNAVAILABLE("Cash-out value is too small to offer.");

  return { available: true, value, currentTotalOdds: Math.round(currentTotalOdds * 100) / 100 };
}
