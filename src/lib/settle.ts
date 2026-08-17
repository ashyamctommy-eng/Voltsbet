import { prisma } from "./prisma";
import { ApiError, auditLog } from "./api";
export type SettleActor = { id: string; username: string };

/**
 * Settlement engine — driven by admins (manual games) or the API sync layer.
 * Marking an outcome WON/LOST/VOID processes every open bet that contains it.
 *
 * Multiples rule (documented MVP behavior): any void selection voids the whole
 * accumulator with a full stake refund; a single lost leg loses the bet.
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
    await tx.outcome.update({ where: { id: outcomeId }, data: { result, settled: true } });

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
      const anyUnsettled = selSettled.some((v) => !v);
      const anyLost = selResults.some((r) => r === "LOST");
      const anyVoid = selResults.some((r) => r === "VOID");
      const allWon = selSettled.every(Boolean) && selResults.every((r) => r === "WON");

      let newStatus = bet.status;
      let payout = 0;
      let payoutType: "BET_WIN" | "BET_REFUND" | null = null;

      if (bet.type === "SINGLE") {
        newStatus = result;
        if (result === "WON") { payout = Number(bet.potentialWin); payoutType = "BET_WIN"; }
        if (result === "VOID") { payout = Number(bet.stake); payoutType = "BET_REFUND"; }
      } else if (!anyUnsettled) {
        // MULTIPLE fully settled now
        if (anyLost) { newStatus = "LOST"; }
        else if (anyVoid) { newStatus = "VOID"; payout = Number(bet.stake); payoutType = "BET_REFUND"; }
        else if (allWon) { newStatus = "WON"; payout = Number(bet.potentialWin); payoutType = "BET_WIN"; }
        else { newStatus = "LOST"; } // fallback: not all won
      }

      if (newStatus !== bet.status) {
        await tx.bet.update({
          where: { id: bet.id },
          data: { status: newStatus, settledAt: new Date() },
        });

        const wallet = bet.user.wallet;
        if (wallet && payout > 0 && payoutType) {
          const prev = Number(wallet.balance);
          const next = Math.round((prev + payout) * 100) / 100;
          await tx.wallet.update({ where: { userId: bet.userId }, data: { balance: next.toFixed(2) } });
          await tx.transaction.create({
            data: {
              userId: bet.userId,
              type: payoutType,
              amount: payout.toFixed(2),
              currencyCode: wallet.currencyCode,
              prevBalance: prev.toFixed(2),
              newBalance: next.toFixed(2),
              reason: `${payoutType === "BET_WIN" ? "Bet won" : "Bet voided"} ${bet.code}`,
              reference: bet.code,
            },
          });
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
    const next = Math.round((prev + amount) * 100) / 100;
    if (next < 0) throw new ApiError(400, "Adjustment would make the balance negative.", "NEGATIVE_BALANCE");
    await tx.wallet.update({ where: { userId }, data: { balance: next.toFixed(2) } });
    const txn = await tx.transaction.create({
      data: {
        userId,
        type: "ADJUSTMENT",
        amount: amount.toFixed(2),
        currencyCode: wallet.currencyCode,
        prevBalance: prev.toFixed(2),
        newBalance: next.toFixed(2),
        reason,
        createdById: admin.id,
      },
    });
    return txn;
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
