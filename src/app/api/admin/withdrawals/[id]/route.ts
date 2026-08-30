import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { npCreatePayout } from "@/lib/providers/nowpayments";
import { mpesaB2c, publicBaseUrl } from "@/lib/providers/mpesa";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { z } from "zod";

const schema = z.object({ status: z.string().min(1), adminNote: z.string().optional().default("") });

/**
 * Withdrawal state machine (money-safe):
 *
 * MPESA  PENDING → PROCESSING  (admin) — funds are RESERVED (wallet debited
 *         atomically) BEFORE the B2C payout fires, so the callback can never
 *         hit an insufficient balance. The B2C callback then finalizes:
 *         success → COMPLETED (no balance change), failure → FAILED + refund.
 *         COMPLETED can never be set directly for MPESA.
 * CRYPTO PENDING → COMPLETED (admin) — payout must be initiated via the
 *         configured provider BEFORE the debit; without a payout key the
 *         action is refused (no silent "manual crypto" debit-with-no-transfer).
 */
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("withdrawals");
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

  const settings = await getSettings();
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(withdrawal.metadata ?? "{}"); } catch {}

  const amount = Number(withdrawal.amount);
  const isMpesa = withdrawal.method === "MPESA";
  const isCrypto = withdrawal.method === "CRYPTO";

  const notify = async (title: string, message: string) => {
    await prisma.notification.create({
      data: { userId: withdrawal.userId, type: "WITHDRAWAL", title, message },
    });
  };

  // ── MPESA: reserve-on-approval state machine ────────────────────────────
  if (isMpesa) {
    if (newStatus === "COMPLETED") {
      throw new ApiError(
        409,
        "M-Pesa withdrawals are completed by the payout callback — set PROCESSING to send the B2C payout.",
        "USE_PROCESSING"
      );
    }

    if (newStatus === "PROCESSING") {
      if (withdrawal.status === "PROCESSING") {
        throw new ApiError(409, "This payout is already being processed.", "ALREADY_PROCESSING");
      }
      // 1) Reserve the funds atomically BEFORE the provider call, so the
      //    callback can never find an insufficient balance (money would have
      //    left the Paybill with no wallet debit — the old bug).
      await prisma.$transaction(async (tx) => {
        await debitWallet(tx, withdrawal.userId, amount, {
          type: "WITHDRAWAL",
          reason: `M-Pesa payout reserved — ${withdrawal.destination}`,
          reference: withdrawal.id,
        });
      });

      // 2) Fire the B2C payout. If initiation fails, refund the reservation
      //    and stay PENDING. (Note: a response-timeout after the request was
      //    actually received by Safaricom can't be matched — the callback has
      //    no conversationId to look up — so such a payout would need manual
      //    reconciliation against M-Pesa statements.)
      try {
        const base = publicBaseUrl(settings);
        const secret = settings.mpesaCallbackSecret;
        const resultUrl = `${base}/api/webhooks/mpesa/b2c?secret=${secret}`;
        const payout = await mpesaB2c({
          amount,
          phone: withdrawal.destination,
          remarks: `VoltBet payout ${withdrawal.id.slice(-8)}`,
          resultUrl,
          queueTimeOutUrl: resultUrl,
        });
        await prisma.withdrawal.update({
          where: { id },
          data: {
            status: "PROCESSING",
            adminNote: parsed.data.adminNote || withdrawal.adminNote,
            metadata: JSON.stringify({ ...metadata, conversationId: payout.ConversationID, originatorConversationId: payout.OriginatorConversationID }),
          },
        });
        await auditLog({
          admin, action: "PAYOUT_INITIATED", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
          prevValue: { status: withdrawal.status, reserved: true }, newValue: { status: "PROCESSING", provider: "MPESA", conversationId: payout.ConversationID },
        });
        return ok({ withdrawal: { id, status: "PROCESSING", payoutInitiated: true, provider: "MPESA", reserved: true } });
      } catch (e) {
        await prisma.$transaction(async (tx) => {
          await creditWallet(tx, withdrawal.userId, amount, {
            type: "WITHDRAWAL_REFUND",
            reason: `M-Pesa payout failed to initiate — reserved funds returned`,
            reference: withdrawal.id,
          });
        });
        throw new ApiError(
          502,
          `M-Pesa payout could not be initiated — nothing was sent and the reservation was refunded. ${e instanceof Error ? e.message : ""}`,
          "PAYOUT_INIT_FAILED"
        );
      }
    }

    // Aborting a payout that already reserved funds → return them.
    if (withdrawal.status === "PROCESSING") {
      await prisma.$transaction(async (tx) => {
        await creditWallet(tx, withdrawal.userId, amount, {
          type: "WITHDRAWAL_REFUND",
          reason: `M-Pesa payout ${newStatus.toLowerCase()} — reserved funds returned`,
          reference: withdrawal.id,
        });
        await tx.withdrawal.update({
          where: { id },
          data: { status: newStatus, adminNote: parsed.data.adminNote || null, metadata: JSON.stringify(metadata) },
        });
      });
      await notify(
        newStatus === "REJECTED" ? "Withdrawal Rejected" : "Withdrawal Cancelled",
        `Your M-Pesa withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} was ${newStatus.toLowerCase()}. Reserved funds were returned to your balance.`
      );
      await auditLog({
        admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
        prevValue: { status: withdrawal.status }, newValue: { status: newStatus, refunded: true, provider: withdrawal.method },
      });
      return ok({ withdrawal: { id, status: newStatus, refunded: true } });
    }

    // Plain status change (PENDING / VERIFICATION_REQUIRED → REJECTED etc.)
    await prisma.withdrawal.update({
      where: { id },
      data: { status: newStatus, adminNote: parsed.data.adminNote || null, metadata: JSON.stringify(metadata) },
    });
    await notify(
      newStatus === "REJECTED" ? "Withdrawal Rejected" : "Withdrawal Cancelled",
      `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} is ${newStatus.toLowerCase()}.`
    );
    await auditLog({
      admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
      prevValue: { status: withdrawal.status }, newValue: { status: newStatus, provider: withdrawal.method },
    });
    return ok({ withdrawal: { id, status: newStatus } });
  }

  // ── CRYPTO: payout first, then debit ────────────────────────────────────
  let debited = false;
  if (isCrypto && newStatus === "COMPLETED") {
    if (!settings.cryptoPayoutApiKey) {
      throw new ApiError(
        503,
        "Crypto payout is not configured (crypto.payoutApiKey). Configure it — or REJECT this withdrawal and return the funds with a balance adjustment.",
        "PAYOUT_UNCONFIGURED"
      );
    }
    const payout = await npCreatePayout({
      address: withdrawal.destination,
      currency: withdrawal.currencyCode === "KES" ? "USDT" : withdrawal.currencyCode, // wallets hold KES → settle in USDT
      amount: amount / (settings.cryptoRates["USDT"] ?? 129),
    }).catch((e) => {
      throw new ApiError(502, `Crypto payout failed — no funds sent. ${e instanceof Error ? e.message : ""}`, "PAYOUT_FAILED");
    });
    metadata.payoutId = payout.withdrawals?.[0]?.id ?? null;

    const result = await prisma.$transaction(async (tx) => {
      await debitWallet(tx, withdrawal.userId, amount, {
        type: "WITHDRAWAL",
        reason: `Withdrawal to ${withdrawal.destination} (${withdrawal.method})`,
        reference: withdrawal.id,
      });
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: "COMPLETED",
          adminNote: parsed.data.adminNote || null,
          metadata: JSON.stringify(metadata),
          processedAt: new Date(),
        },
      });
      return { prev: Number(withdrawal.user.wallet?.balance ?? 0) };
    });
    debited = true;
    void result;
    await notify(
      "Withdrawal Completed ✅",
      `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} is completed.`
    );
    await auditLog({
      admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
      prevValue: { status: withdrawal.status }, newValue: { status: newStatus, debited, provider: withdrawal.method, payoutId: metadata.payoutId },
    });
    return ok({ withdrawal: { id, status: newStatus, debited } });
  }

  // Generic status change (no money movement)
  await prisma.withdrawal.update({
    where: { id },
    data: { status: newStatus, adminNote: parsed.data.adminNote || null, metadata: JSON.stringify(metadata) },
  });
  await notify(
    newStatus === "COMPLETED" ? "Withdrawal Completed ✅" : `Withdrawal ${newStatus.toLowerCase()}`,
    `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} is ${newStatus.toLowerCase()}.`
  );
  await auditLog({
    admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
    prevValue: { status: withdrawal.status }, newValue: { status: newStatus, debited, provider: withdrawal.method },
  });
  return ok({ withdrawal: { id, status: newStatus, debited } });
});
