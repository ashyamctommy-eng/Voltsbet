import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { awardReferralBonusIfFirstDeposit } from "@/lib/referral";
import { creditWallet } from "@/lib/wallet";

/**
 * Shared payment-confirmation logic. Every provider (demo webhook,
 * NOWPayments IPN, M-Pesa callback, admin manual confirm) funnels into
 * `confirmDeposit` — one atomic credit path, so no channel can behave
 * differently or double-credit.
 */

const CREDITABLE_FROM = ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING", "CONFIRMED"];

/** Atomically confirm a deposit: COMPLETED + wallet credit + transaction + notification. */
export async function confirmDeposit(
  depositId: string,
  opts: { txHash?: string; depositAddress?: string; providerRef?: string } = {},
  adminOverride = false
) {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    include: { user: { include: { wallet: true } } },
  });
  if (!deposit) throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  if (deposit.status === "COMPLETED") {
    return { alreadyCompleted: true, deposit };
  }
  if (!adminOverride && !CREDITABLE_FROM.includes(deposit.status)) {
    throw new ApiError(409, `Deposit is in status ${deposit.status} and cannot be completed.`, "BAD_STATUS");
  }

  const result = await prisma.$transaction(async (tx) => {
    // merge provider refs into metadata (keep prior info like payment address)
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(deposit.metadata ?? "{}"); } catch {}
    if (opts.providerRef) metadata.providerRef = opts.providerRef;
    if (opts.depositAddress) metadata.depositAddress = opts.depositAddress;

    // Atomic status claim — concurrent confirmations (webhook retry + admin
    // click, STK callback + GET poll) can never both credit: exactly one
    // caller flips a non-COMPLETED status → COMPLETED.
    const claimed = await tx.deposit.updateMany({
      where: adminOverride
        ? { id: deposit.id, status: { not: "COMPLETED" } }
        : { id: deposit.id, status: { in: CREDITABLE_FROM } },
      data: {
        status: "COMPLETED",
        ...(opts.txHash ? { txHash: opts.txHash } : {}),
        metadata: JSON.stringify(metadata),
        confirmedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      // Lost the race — a concurrent call completed it, or the status moved.
      const fresh = await tx.deposit.findUnique({ where: { id: deposit.id }, select: { status: true } });
      if (fresh?.status === "COMPLETED") {
        throw new ApiError(409, "Deposit already completed.", "ALREADY_COMPLETED");
      }
      throw new ApiError(409, `Deposit is in status ${fresh?.status ?? "?"} and cannot be completed.`, "BAD_STATUS");
    }

    const amount = Number(deposit.amount);
    await creditWallet(tx, deposit.userId, amount, {
      type: "DEPOSIT",
      reason: `Deposit via ${deposit.provider}${deposit.cryptoCurrency ? ` (${deposit.cryptoCurrency})` : ""}`,
      reference: deposit.id,
      currencyCode: deposit.currencyCode,
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

    return { amount };
  });

  return { alreadyCompleted: false, ...result, deposit };
}

/**
 * Non-credit status transitions (expired / failed / confirming / underpaid…).
 *
 * Every update runs inside a DB transaction guarded by
 * `WHERE status != 'COMPLETED'` — a completed deposit has already credited
 * the wallet and must never be overwritten by a late webhook/retry, and a
 * concurrent non-credit update can never clobber a competing one. Returns
 * `{ skipped: true }` when the deposit is already COMPLETED or the guard
 * rejected the update (the caller can treat both as no-op).
 */
export async function updateDepositStatus(depositId: string, status: string) {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId }, select: { status: true } });
  if (!deposit) throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  if (deposit.status === "COMPLETED") return { skipped: true };

  const claimed = await prisma.$transaction((tx) =>
    tx.deposit.updateMany({
      where: { id: depositId, status: { not: "COMPLETED" } },
      data: { status },
    })
  );
  return { skipped: claimed.count === 0 };
}

/**
 * Expire stale payment windows: deposits still awaiting payment after their
 * provider expiry (crypto payments have expiresAt) are flipped to EXPIRED so
 * they surface in the admin panel instead of lingering forever. Money-safe:
 * only non-COMPLETED deposits are touched, and EXPIRED is not a creditable
 * status — a late webhook can never credit an expired deposit through the
 * normal confirm path.
 */
export async function expireStaleDeposits(): Promise<number> {
  const res = await prisma.deposit.updateMany({
    where: {
      status: { in: CREDITABLE_FROM },
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return res.count;
}
