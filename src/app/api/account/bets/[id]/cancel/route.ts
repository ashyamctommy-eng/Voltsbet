import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { BET_CANCEL_WINDOW_MS } from "@/lib/bet-engine";

/**
 * Cancel an OPEN bet inside the cancellation window — voids the bet, marks
 * every selection VOID/settled, and refunds the full stake to the wallet
 * (mirror of the BET_STAKE debit in the place flow).
 */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const { id } = await ctx.params;

  const bet = await prisma.bet.findFirst({ where: { id, userId: user.id } });
  if (!bet) throw new ApiError(404, "Bet not found.", "NOT_FOUND");
  if (bet.status !== "OPEN") {
    throw new ApiError(400, "This bet can no longer be cancelled — it has already settled.", "NOT_CANCELLABLE");
  }
  if (Date.now() - bet.createdAt.getTime() > BET_CANCEL_WINDOW_MS) {
    throw new ApiError(400, "The cancellation window has expired.", "WINDOW_EXPIRED");
  }

  const stake = Number(bet.stake);
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
    const balance = Number(wallet.balance);
    const newBalance = Math.round((balance + stake) * 100) / 100;

    await tx.wallet.update({
      where: { userId: user.id },
      data: { balance: newBalance.toFixed(2) },
    });
    await tx.transaction.create({
      data: {
        userId: user.id,
        type: "BET_REFUND",
        amount: stake.toFixed(2),
        currencyCode: wallet.currencyCode,
        prevBalance: balance.toFixed(2),
        newBalance: newBalance.toFixed(2),
        reason: `Bet cancelled ${bet.code}`,
        reference: bet.code,
      },
    });
    await tx.bet.update({ where: { id }, data: { status: "VOID", settledAt: new Date() } });
    await tx.betSelection.updateMany({ where: { betId: id }, data: { result: "VOID", settled: true } });
  });

  return ok({ message: `Bet ${bet.code} cancelled — stake refunded.` });
});
