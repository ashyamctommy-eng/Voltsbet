import { prisma } from "./prisma";
import { ApiError, auditLog } from "./api";
import { creditWallet } from "./wallet";

/**
 * Admin withdrawal state machine — manual-ops model, no external payout APIs.
 *
 * Funds are RESERVED AT CREATION (atomic wallet debit inside one DB
 * transaction in /api/account/withdraw) — every PENDING withdrawal already
 * holds its money. Admin actions only finalize or release:
 *
 *   approve  PENDING/VERIFICATION_REQUIRED → COMPLETED
 *            Single-click, no receipt required — the auto-assigned
 *            PLP-WDR-* reference code is the audit trail. No wallet
 *            movement: the reservation covered the payout.
 *   reject   PENDING/VERIFICATION_REQUIRED/PROCESSING → REJECTED | CANCELLED
 *            Reserved funds are refunded to the wallet — exactly once
 *            (atomic status claim + refunded flag inside one transaction).
 *
 * Every transition is claimed with an atomic status-guarded updateMany so two
 * admins (or a redelivered webhook + an admin) can never double-pay or
 * double-refund.
 */

const PRE_FINAL = ["PENDING", "VERIFICATION_REQUIRED", "PROCESSING"];
const FINAL = ["COMPLETED", "REJECTED", "CANCELLED", "FAILED"];

export type WithdrawalActor = { id: string; username: string };

function safeMeta(metadata: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}

/** Approve a withdrawal: PENDING → COMPLETED (funds already reserved). */
export async function approveWithdrawal(actor: WithdrawalActor, withdrawalId: string) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new ApiError(404, "Withdrawal not found.", "NOT_FOUND");
  if (FINAL.includes(withdrawal.status)) {
    throw new ApiError(409, `This withdrawal is already ${withdrawal.status.toLowerCase()} and cannot be changed.`, "LOCKED");
  }

  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: { in: PRE_FINAL } },
    data: { status: "COMPLETED", processedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new ApiError(409, "This withdrawal changed state — refresh and try again.", "RACE");
  }

  const ref = withdrawal.trackingId ?? withdrawal.id;
  await prisma.notification.create({
    data: {
      userId: withdrawal.userId,
      type: "WITHDRAWAL",
      title: "Withdrawal Completed ✅",
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} (${ref}) is completed.`,
    },
  });
  await auditLog({
    admin: actor,
    action: "PAYMENT_STATUS_CHANGE",
    entity: "WITHDRAWAL",
    entityId: withdrawalId,
    userId: withdrawal.userId,
    prevValue: { status: withdrawal.status, reserved: true },
    newValue: { status: "COMPLETED", provider: withdrawal.method, referenceCode: ref, manual: true },
  });

  return { id: withdrawalId, status: "COMPLETED", referenceCode: ref };
}

/**
 * Reject/cancel a withdrawal: PENDING → REJECTED|CANCELLED with an
 * exactly-once refund of the reserved funds.
 */
export async function rejectWithdrawal(
  actor: WithdrawalActor,
  withdrawalId: string,
  status: "REJECTED" | "CANCELLED" = "REJECTED",
) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new ApiError(404, "Withdrawal not found.", "NOT_FOUND");
  if (FINAL.includes(withdrawal.status)) {
    throw new ApiError(409, `This withdrawal is already ${withdrawal.status.toLowerCase()} and cannot be changed.`, "LOCKED");
  }

  const amount = Number(withdrawal.amount);
  const ref = withdrawal.trackingId ?? withdrawal.id;

  const refunded = await prisma.$transaction(async (tx) => {
    // Atomic status claim — exactly one caller may move this withdrawal.
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: { in: PRE_FINAL } },
      data: { status, processedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ApiError(409, "This withdrawal changed state — refresh and try again.", "RACE");
    }

    // Refund the reservation exactly once (guarded by the refunded flag).
    const meta = safeMeta(withdrawal.metadata);
    if (meta.reserved !== true || meta.refunded === true) return false;
    await creditWallet(tx, withdrawal.userId, amount, {
      type: "WITHDRAWAL_REFUND",
      method: withdrawal.method,
      reason: `Withdrawal ${ref} ${status.toLowerCase()} — reserved funds returned`,
      reference: ref,
    });
    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { metadata: JSON.stringify({ ...meta, refunded: true }) },
    });
    return true;
  });

  await prisma.notification.create({
    data: {
      userId: withdrawal.userId,
      type: "WITHDRAWAL",
      title: status === "REJECTED" ? "Withdrawal Rejected" : "Withdrawal Cancelled",
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} (${ref}) was ${status.toLowerCase()}${refunded ? " and the reserved funds were returned to your balance" : ""}.`,
    },
  });
  await auditLog({
    admin: actor,
    action: "PAYMENT_STATUS_CHANGE",
    entity: "WITHDRAWAL",
    entityId: withdrawalId,
    userId: withdrawal.userId,
    prevValue: { status: withdrawal.status, reserved: true },
    newValue: { status, refunded, provider: withdrawal.method },
  });

  return { id: withdrawalId, status, refunded };
}
