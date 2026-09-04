import { prisma } from "./prisma";
import { ApiError, auditLog } from "./api";
import { creditWallet, debitWallet, toCents, refundBetStake } from "./wallet";
export type SettleActor = { id: string; username: string };

/**
 * Settlement engine — driven by admins (manual games) or the API sync layer.
 * Marking an outcome WON/LOST/VOID processes every open bet that contains it.
 *
 * Multiples rule (documented MVP behavior): any void selection voids the whole
 * accumulator with a full stake refund; a single lost leg loses the bet.
 *
 * Race-safety: the outcome is claimed with an atomic `settled:false` guard
 * inside the transaction, so two concurrent settle calls (admin + auto-settle
 * cron) can never both pay the same open bets.
 */
export async function settleOutcome(admin: SettleActor, outcomeId: string, result: "WON" | "LOST" | "VOID") {
  const outcome = await prisma.outcome.findUnique({
    where: { id: outcomeId },
    include: { market: { include: { game: true } } },
  });
  if (!outcome) throw new ApiError(404, "Outcome not found.", "NOT_FOUND");
  if (outcome.settled) {
    throw new ApiError(409, "This outcome is already settled. Reopen it first to change the result.", "ALREADY_SETTLED");
  }

  const settled = await prisma.$transaction(async (tx) => {
    // Atomic claim — exactly one caller may settle this outcome.
    const claimed = await tx.outcome.updateMany({
      where: { id: outcomeId, settled: false },
      data: { result, settled: true },
    });
    if (claimed.count === 0) {
      throw new ApiError(409, "This outcome is already settled. Reopen it first to change the result.", "ALREADY_SETTLED");
    }

    // Find open bets that contain this outcome
    const openBets = await tx.bet.findMany({
      where: {
        status: "OPEN",
        selections: { some: { outcomeId } },
      },
      include: {
        selections: { include: { outcome: true } },
        user: { include: { wallet: true } },
      },
    });

    const affected: string[] = [];
    for (const bet of openBets) {
      const sel = bet.selections.find((s) => s.outcomeId === outcomeId)!;
      await tx.betSelection.update({
        where: { id: sel.id },
        data: { result, settled: true },
      });

      // Fresh view: this selection now has `result`; the others keep their state
      const selResults = bet.selections.map((s) => (s.id === sel.id ? result : s.result));
      const selSettled = bet.selections.map((s) => (s.id === sel.id ? true : s.settled));

      let newStatus = bet.status;
      let payout = 0;
      let payoutType: "BET_WIN" | "BET_REFUND" | null = null;

      if (bet.type === "SINGLE") {
        newStatus = result;
        if (result === "WON") { payout = Number(bet.potentialWin); payoutType = "BET_WIN"; }
        if (result === "VOID") { payout = Number(bet.stake); payoutType = "BET_REFUND"; }
      } else {
        // MULTIPLE — parlay reduction (industry standard):
        //   - a LOST leg kills the acca immediately, even while other legs
        //     are still unsettled (a dead acca doesn't wait);
        //   - a VOID leg with unsettled legs remaining REMOVES the leg and
        //     continues at reduced odds (totalOdds ÷ void leg odds, same
        //     stake) instead of refunding the whole acca;
        //   - when fully settled with no losses: all-void → refund, any
        //     non-void win (incl. void-reduced) → payout at (reduced) odds.
        const anyLost = selResults.some((r) => r === "LOST");
        const allSettled = selSettled.every(Boolean);

        if (anyLost) {
          newStatus = "LOST";
        } else if (!allSettled) {
          if (result === "VOID") {
            // Reduce to remaining legs: void odds → 1.0, stake unchanged.
            const voidOdds = Math.max(1.01, Number(sel.oddsAtPlacement));
            const reducedTotal = Math.round((Number(bet.totalOdds) / voidOdds) * 100) / 100;
            const reducedWin = Math.round(Number(bet.stake) * reducedTotal * 100) / 100;
            await tx.bet.update({
              where: { id: bet.id },
              data: { totalOdds: reducedTotal.toFixed(2), potentialWin: reducedWin.toFixed(2) },
            });
            await tx.notification.create({
              data: {
                userId: bet.userId,
                type: "BET_RESULT",
                title: "Acca Reduced 📉",
                message: `One leg of ${bet.code} was voided — your accumulator continues at reduced odds (${reducedTotal.toFixed(2)}).`,
              },
            });
          }
          // A WON leg while others are unsettled → nothing to do yet.
        } else {
          // Fully settled, no lost legs.
          if (selResults.every((r) => r === "VOID")) {
            newStatus = "VOID"; payout = Number(bet.stake); payoutType = "BET_REFUND";
          } else {
            newStatus = "WON"; payout = Number(bet.potentialWin); payoutType = "BET_WIN";
          }
        }
      }

      if (newStatus !== bet.status) {
        // Atomic claim: exactly one actor (settle / cancel / cash-out) may
        // move this bet out of OPEN. If another actor won the race (e.g. the
        // player cashed out a moment ago), skip the payout entirely — no
        // double credit.
        const claimed = await tx.bet.updateMany({
          where: { id: bet.id, status: "OPEN" },
          data: { status: newStatus, settledAt: new Date() },
        });

        if (claimed.count > 0) {
          if (payout > 0 && payoutType) {
            if (payoutType === "BET_REFUND") {
              // Voided bet: refund the stake to the pools it came from — the
              // bonus-funded portion (bonusStake) returns to bonusBalance.
              await refundBetStake(tx, bet.userId, Number(bet.stake), Number(bet.bonusStake ?? 0), bet.code, "Bet voided");
            } else {
              await creditWallet(tx, bet.userId, payout, {
                type: payoutType,
                reason: `Bet won ${bet.code}`,
                reference: bet.code,
              });
            }
          }
          affected.push(bet.code);

          // Notify the user
          await tx.notification.create({
            data: {
              userId: bet.userId,
              type: "BET_RESULT",
              title: newStatus === "WON" ? "Bet Won 🏆" : newStatus === "VOID" ? "Bet Voided" : "Bet Lost",
              message:
                newStatus === "WON"
                  ? `Your bet ${bet.code} won. ${payout.toFixed(2)} was credited to your balance.`
                  : newStatus === "VOID"
                    ? `Your bet ${bet.code} was voided and your stake refunded.`
                    : `Your bet ${bet.code} was settled as lost.`,
            },
          });
        }
      }
    }

    // Close the market when all its outcomes are settled
    const marketOutcomes = await tx.outcome.findMany({ where: { marketId: outcome.marketId } });
    if (marketOutcomes.every((o) => o.settled)) {
      await tx.market.update({ where: { id: outcome.marketId }, data: { status: "SETTLED" } });
    }
    return { affected };
  });

  await auditLog({
    admin,
    action: "SETTLE",
    entity: "OUTCOME",
    entityId: outcomeId,
    gameId: outcome.market.gameId,
    newValue: { result, market: outcome.market.name, outcome: outcome.name },
  });

  return settled;
}

/** Reopen a settlement — only allowed if no bet has been settled by it. */
export async function reopenOutcome(admin: SettleActor, outcomeId: string) {
  const outcome = await prisma.outcome.findUnique({
    where: { id: outcomeId },
    include: { market: true },
  });
  if (!outcome) throw new ApiError(404, "Outcome not found.", "NOT_FOUND");
  if (!outcome.settled) throw new ApiError(409, "This outcome is not settled.", "NOT_SETTLED");

  const settledBets = await prisma.bet.count({
    where: { selections: { some: { outcomeId, settled: true } } },
  });
  if (settledBets > 0) {
    throw new ApiError(
      409,
      `Cannot reopen: ${settledBets} bet(s) were settled by this outcome. Reopening would require reversing settlements.`,
      "REOPEN_BLOCKED"
    );
  }

  await prisma.outcome.update({ where: { id: outcomeId }, data: { result: null, settled: false } });
  await prisma.market.update({ where: { id: outcome.marketId }, data: { status: "OPEN" } });

  await auditLog({
    admin,
    action: "REOPEN",
    entity: "OUTCOME",
    entityId: outcomeId,
    newValue: { note: "Settlement reopened" },
  });
  return { ok: true };
}

/** Manually credit/debit a user balance (finance/admin), always with a transaction record + audit. */
export async function adjustBalance(
  admin: SettleActor,
  userId: string,
  amount: number,
  reason: string
) {
  if (!(amount !== 0 && Number.isFinite(amount))) {
    throw new ApiError(400, "Invalid adjustment amount.", "INVALID_AMOUNT");
  }
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new ApiError(404, "User has no wallet.", "NO_WALLET");
    const prev = Number(wallet.balance);
    const next = toCents(prev + amount);
    if (next < 0) throw new ApiError(400, "Adjustment would make the balance negative.", "NEGATIVE_BALANCE");

    if (amount > 0) {
      await creditWallet(tx, userId, amount, {
        type: "ADJUSTMENT",
        reason,
        createdById: admin.id,
      });
    } else {
      await debitWallet(tx, userId, -amount, {
        type: "ADJUSTMENT",
        reason,
        createdById: admin.id,
      });
    }
    return { amount, prev, next };
  });
  await auditLog({
    admin,
    action: "BALANCE_ADJUSTMENT",
    entity: "USER",
    entityId: userId,
    userId,
    prevValue: { amount: result.amount },
    newValue: { reason },
  });
  return result;
}
