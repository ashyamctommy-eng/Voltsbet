import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { creditWallet } from "@/lib/wallet";
import { z } from "zod";

const schema = z.object({
  status: z.string().min(1),
  adminNote: z.string().optional().default(""),
  payoutRef: z.string().optional().default(""), // manual payout receipt (tx hash, M-Pesa code…)
});

/**
 * Withdrawal state machine (manual-ops model — no external payout APIs):
 *
 * Funds are RESERVED AT CREATION (atomic wallet debit inside one DB
 * transaction in /api/account/withdraw) — every PENDING withdrawal already
 * holds its money. Admin actions only finalize or release:
 *
 *   COMPLETE  PENDING/VERIFICATION_REQUIRED → COMPLETED
 *             Manual path only: the admin must bind a payout receipt
 *             (payoutRef — external tx hash, M-Pesa code… — or an adminNote)
 *             attesting how the money was sent. No wallet movement — the
 *             reservation covered it.
 *   REJECT    PENDING/VERIFICATION_REQUIRED → REJECTED
 *             Reserved funds are refunded to the wallet — exactly once.
 *   CANCEL    Same as REJECT — reserved funds returned to the wallet.
 *
 * All transitions are claimed with atomic status-guarded updateMany calls so
 * two admins can never double-refund or double-pay.
 */

const PRE_FINAL = ["PENDING", "VERIFICATION_REQUIRED", "PROCESSING"];

function safeMeta(metadata: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "withdrawals");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id }, include: { user: { include: { wallet: true } } },
  });
  if (!withdrawal) throw new ApiError(404, "Withdrawal not found.", "NOT_FOUND");

  const newStatus = parsed.data.status;
  const FINAL = ["COMPLETED", "REJECTED", "CANCELLED", "FAILED"];
  if (FINAL.includes(withdrawal.status)) {
    throw new ApiError(409, `This withdrawal is already ${withdrawal.status.toLowerCase()} and cannot be changed.`, "LOCKED");
  }
  if (!["COMPLETED", "REJECTED", "CANCELLED"].includes(newStatus)) {
    throw new ApiError(400, `Unsupported status transition: ${newStatus}.`, "BAD_STATUS");
  }

  const amount = Number(withdrawal.amount);
  const ref = withdrawal.trackingId ?? withdrawal.id;

  const notify = async (title: string, message: string) => {
    await prisma.notification.create({
      data: { userId: withdrawal.userId, type: "WITHDRAWAL", title, message },
    });
  };

  /** Refund the reservation — caller must have won the atomic status claim. */
  const refundReserved = async (reason: string) => {
    const meta = safeMeta(withdrawal.metadata);
    if (meta.reserved !== true || meta.refunded === true) return false;
    await prisma.$transaction(async (tx) => {
      await creditWallet(tx, withdrawal.userId, amount, {
        type: "WITHDRAWAL_REFUND",
        method: withdrawal.method,
        reason,
        reference: withdrawal.trackingId ?? withdrawal.id,
      });
      await tx.withdrawal.update({
        where: { id },
        data: { metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), refunded: true }) },
      });
    });
    return true;
  };

  // ── REJECT / CANCEL — manual rejection path with exactly-once refund ────
  if (newStatus === "REJECTED" || newStatus === "CANCELLED") {
    const claimed = await prisma.withdrawal.updateMany({
      where: { id, status: { in: PRE_FINAL } },
      data: { status: newStatus, adminNote: parsed.data.adminNote || null },
    });
    if (claimed.count === 0) {
      throw new ApiError(409, "This withdrawal changed state — refresh and try again.", "RACE");
    }
    const refunded = await refundReserved(`Withdrawal ${ref} ${newStatus.toLowerCase()} — reserved funds returned`);
    await notify(
      newStatus === "REJECTED" ? "Withdrawal Rejected" : "Withdrawal Cancelled",
      `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} (${ref}) was ${newStatus.toLowerCase()}${refunded ? " and the reserved funds were returned to your balance" : ""}.`
    );
    await auditLog({
      admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
      prevValue: { status: withdrawal.status }, newValue: { status: newStatus, refunded, provider: withdrawal.method },
    });
    return ok({ withdrawal: { id, status: newStatus, refunded } });
  }

  // ── APPROVE → COMPLETED (manual payout receipt binding) ─────────────────
  if (newStatus === "COMPLETED") {
    // No external payout APIs are called. The admin must attest HOW the
    // player was paid — a payout reference (tx hash / payment code) or an
    // admin note describing the manual payout.
    if (!parsed.data.payoutRef && !parsed.data.adminNote) {
      throw new ApiError(
        400,
        "Manual approval requires a payout reference (tx hash / payment code) or an admin note describing the payout.",
        "PAYOUT_REF_REQUIRED"
      );
    }

    const claimed = await prisma.withdrawal.updateMany({
      where: { id, status: { in: PRE_FINAL } },
      data: {
        status: "COMPLETED",
        adminNote: parsed.data.adminNote || withdrawal.adminNote,
        metadata: JSON.stringify({
          ...safeMeta(withdrawal.metadata),
          ...(parsed.data.payoutRef ? { payoutRef: parsed.data.payoutRef } : {}),
          manual: true,
          completedAt: new Date().toISOString(),
        }),
        processedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ApiError(409, "This withdrawal changed state — refresh and try again.", "RACE");
    }
    await notify(
      "Withdrawal Completed ✅",
      `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} (${ref}) is completed.`
    );
    await auditLog({
      admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
      prevValue: { status: withdrawal.status },
      newValue: { status: newStatus, provider: withdrawal.method, payoutRef: parsed.data.payoutRef || undefined, manual: true },
    });
    return ok({ withdrawal: { id, status: newStatus, reserved: true } });
  }

  throw new ApiError(400, "Unsupported transition.", "BAD_STATUS");
});
