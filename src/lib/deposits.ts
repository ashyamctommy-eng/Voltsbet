import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { awardReferralBonusIfFirstDeposit } from "@/lib/referral";

/**
 * Shared payment-confirmation logic. Every provider (demo webhook,
 * NOWPayments IPN, M-Pesa callback, admin manual confirm) funnels into
 * `confirmDeposit` — one atomic credit path, so no channel can behave
 * differently or double-credit.
 */

const CREDITABLE_FROM = ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING", "CONFIRMED"];

/** Atomically confirm a deposit: COMPLETED + wallet credit + transaction + notification. */
export async function confirmDeposit(depositId: string, opts: { txHash?: string; providerRef?: string } = {}) {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    include: { user: { include: { wallet: true } } },
  });
  if (!deposit) throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  if (deposit.status === "COMPLETED") {
    return { alreadyCompleted: true, deposit };
  }
  if (!CREDITABLE_FROM.includes(deposit.status)) {
    throw new ApiError(409, `Deposit is in status ${deposit.status} and cannot be completed.`, "BAD_STATUS");
  }

  const result = await prisma.$transaction(async (tx) => {
    const wallet = deposit.user.wallet!;
    const prev = Number(wallet.balance);
    const amount = Number(deposit.amount);
    const next = Math.round((prev + amount) * 100) / 100;

    // merge provider refs into metadata (keep prior info like payment address)
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(deposit.metadata ?? "{}"); } catch {}
    if (opts.providerRef) metadata.providerRef = opts.providerRef;

    await tx.deposit.update({
      where: { id: deposit.id },
      data: {
        status: "COMPLETED",
        ...(opts.txHash ? { txHash: opts.txHash } : {}),
        metadata: JSON.stringify(metadata),
        confirmedAt: new Date(),
      },
    });
    await tx.wallet.update({ where: { userId: deposit.userId }, data: { balance: next.toFixed(2) } });
    await tx.transaction.create({
      data: {
        userId: deposit.userId,
        type: "DEPOSIT",
        amount: amount.toFixed(2),
        currencyCode: deposit.currencyCode,
        prevBalance: prev.toFixed(2),
        newBalance: next.toFixed(2),
        reason: `Deposit via ${deposit.provider}${deposit.cryptoCurrency ? ` (${deposit.cryptoCurrency})` : ""}`,
        reference: deposit.id,
      },
    });
    await tx.notification.create({
      data: {
        userId: deposit.userId,
        type: "DEPOSIT",
        title: "Deposit Confirmed ✅",
        message: `${amount} ${deposit.currencyCode} was credited to your balance.`,
      },
    });

    // First-deposit referral reward for whoever referred this user
    await awardReferralBonusIfFirstDeposit(tx, deposit);

    return { prev, next, amount };
  });

  return { alreadyCompleted: false, ...result, deposit };
}

/** Non-credit status transitions (expired / failed / cancelled etc.). */
export async function updateDepositStatus(depositId: string, status: string) {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  if (deposit.status === "COMPLETED") return { skipped: true };
  await prisma.deposit.update({ where: { id: depositId }, data: { status } });
  return { skipped: false };
}
