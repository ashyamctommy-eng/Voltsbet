import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { BET_CANCEL_WINDOW_MS } from "@/lib/bet-engine";
import { creditWallet } from "@/lib/wallet";

/**
 * Cancel an OPEN bet inside the cancellation window — voids the bet, marks
 * every selection VOID/settled, and refunds the full stake to the wallet
 * (mirror of the BET_STAKE debit in the place flow).
 *
 * Race-safety: the OPEN → VOID transition is claimed with an atomic
 * `updateMany(where status: OPEN)` inside the tx. If the settlement engine
 * settles the bet (or another cancel wins) between our check and commit, the
 * claim fails and the refund is never issued — no double credit.
 */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const { id } = await ctx.params;

  const bet = await prisma.bet.findFirst({ where: { id, userId: user.id } });
  if (!bet) throw new ApiError(404, "Bet not found.", "NOT_FOUND");
  if (Date.now() - bet.createdAt.getTime() > BET_CANCEL_WINDOW_MS) {
    throw new ApiError(400, "The cancellation window has expired.", "WINDOW_EXPIRED");
  }

  const stake = Number(bet.stake);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.bet.updateMany({
      where: { id, userId: user.id, status: "OPEN" },
      data: { status: "VOID", settledAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ApiError(400, "This bet can no longer be cancelled — it has already settled.", "NOT_CANCELLABLE");
    }
    await creditWallet(tx, user.id, stake, {
      type: "BET_REFUND",
      reason: `Bet cancelled ${bet.code}`,
      reference: bet.code,
    });
    await tx.betSelection.updateMany({ where: { betId: id }, data: { result: "VOID", settled: true } });
  });

  return ok({ message: `Bet ${bet.code} cancelled — stake refunded.` });
});
