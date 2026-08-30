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
 * MPESA  PENDING → PROCESSING (admin) — the PENDING→PROCESSING transition is
 *         claimed ATOMICALLY and the funds are RESERVED (wallet debit) in the
 *         SAME transaction, BEFORE the B2C payout fires. The B2C callback
 *         then finalizes: success → COMPLETED (no balance change), failure →
 *         FAILED + refund. COMPLETED can never be set directly for MPESA.
 * CRYPTO PENDING → PROCESSING (claim) → payout via provider → COMPLETED
 *         (debit only AFTER the provider confirms initiation). Without a
 *         payout key the action is refused — no silent "manual crypto"
 *         debit-with-no-transfer.
 *
 * Concurrent clicks can't double-payout: only one caller wins the atomic
 * status claim; a crashed attempt is reclaimed only after 10 minutes.
 */

const STALE_PROCESSING_MS = 10 * 60_000;
const PRE_PROCESSING = ["PENDING", "VERIFICATION_REQUIRED"];

function safeMeta(metadata: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}

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
  let metadata = safeMeta(withdrawal.metadata);

  const amount = Number(withdrawal.amount);
  const isMpesa = withdrawal.method === "MPESA";
  const isCrypto = withdrawal.method === "CRYPTO";

  const notify = async (title: string, message: string) => {
    await prisma.notification.create({
      data: { userId: withdrawal.userId, type: "WITHDRAWAL", title, message },
    });
  };

  /**
   * Atomically claim PENDING → PROCESSING (with reservation for MPESA).
   * Exactly one caller wins; a PROCESSING row older than 10 minutes is
   * treated as a crashed attempt and reclaimed:
   *   - MPESA:   the old reservation is refunded, then re-reserved.
   *   - CRYPTO:  if the payout was already initiated (payoutId stored) we
   *              finalize instead of sending a second payout; otherwise the
   *              row is reset to PENDING and re-claimed.
   */
  const beginProcessing = async (): Promise<void> => {
    const claimTx = async () => {
      const claimed = await prisma.$transaction(async (tx) => {
        const res = await tx.withdrawal.updateMany({
          where: { id, status: { in: PRE_PROCESSING } },
          data: {
            status: "PROCESSING",
            metadata: JSON.stringify({
              ...metadata,
              processingStartedAt: new Date().toISOString(),
              reserved: isMpesa,
            }),
          },
        });
        if (res.count === 0) return 0;
        if (isMpesa) {
          await debitWallet(tx, withdrawal.userId, amount, {
            type: "WITHDRAWAL",
            reason: `M-Pesa payout reserved — ${withdrawal.destination}`,
            reference: withdrawal.id,
          });
        }
        return 1;
      });
      if (claimed === 0) return false;
      metadata = { ...metadata, processingStartedAt: new Date().toISOString(), reserved: isMpesa };
      return true;
    };

    if (await claimTx()) return;

    // Claim failed — either genuinely in progress, or a crashed attempt.
    const current = await prisma.withdrawal.findUnique({
      where: { id }, select: { status: true, metadata: true },
    });
    const curMeta = safeMeta(current?.metadata);
    const started = curMeta.processingStartedAt ? new Date(String(curMeta.processingStartedAt)).getTime() : 0;
    const stale = current?.status === "PROCESSING" && Date.now() - started > STALE_PROCESSING_MS;

    if (stale && isCrypto && curMeta.payoutId) {
      // Payout was initiated before the crash — finish it, don't re-send.
      return;
    }
    if (stale) {
      if (isMpesa && curMeta.reserved === true) {
        await prisma.$transaction(async (tx) => {
          await creditWallet(tx, withdrawal.userId, amount, {
            type: "WITHDRAWAL_REFUND",
            reason: "M-Pesa payout attempt timed out — reservation returned",
            reference: withdrawal.id,
          });
        });
      }
      await prisma.withdrawal.update({
        where: { id },
        data: { status: "PENDING", metadata: JSON.stringify({ ...curMeta, reserved: false }) },
      });
      if (await claimTx()) return;
    }
    throw new ApiError(409, "This payout is already being processed. Try again in a few minutes.", "ALREADY_PROCESSING");
  };

  /** Revert an in-flight processing attempt (init failed / admin abort). */
  const abortProcessing = async (abortStatus: string, reason: string) => {
    const cur = await prisma.withdrawal.findUnique({ where: { id }, select: { metadata: true } });
    const curMeta = safeMeta(cur?.metadata);
    if (curMeta.reserved === true) {
      await prisma.$transaction(async (tx) => {
        await creditWallet(tx, withdrawal.userId, amount, {
          type: "WITHDRAWAL_REFUND",
          reason,
          reference: withdrawal.id,
        });
        await tx.withdrawal.update({
          where: { id },
          data: { status: abortStatus, metadata: JSON.stringify({ ...curMeta, reserved: false }) },
        });
      });
    } else {
      await prisma.withdrawal.update({
        where: { id },
        data: { status: abortStatus, metadata: JSON.stringify(curMeta) },
      });
    }
  };

  // ── MPESA state machine ────────────────────────────────────────────────
  if (isMpesa) {
    if (newStatus === "COMPLETED") {
      throw new ApiError(
        409,
        "M-Pesa withdrawals are completed by the payout callback — set PROCESSING to send the B2C payout.",
        "USE_PROCESSING"
      );
    }

    if (newStatus === "PROCESSING") {
      await beginProcessing();

      // Fire the B2C payout. If initiation fails, refund the reservation and
      // stay PENDING. (A response-timeout after Safaricom actually received
      // the request can't be matched — the callback would carry a
      // conversationId we never stored — such a payout needs manual
      // reconciliation against M-Pesa statements.)
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
        // Persist the conversationId immediately — the callback matches on it.
        await prisma.withdrawal.update({
          where: { id },
          data: {
            adminNote: parsed.data.adminNote || withdrawal.adminNote,
            metadata: JSON.stringify({
              ...metadata,
              conversationId: payout.ConversationID,
              originatorConversationId: payout.OriginatorConversationID,
            }),
          },
        });
        await auditLog({
          admin, action: "PAYOUT_INITIATED", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
          prevValue: { status: withdrawal.status, reserved: true }, newValue: { status: "PROCESSING", provider: "MPESA", conversationId: payout.ConversationID },
        });
        return ok({ withdrawal: { id, status: "PROCESSING", payoutInitiated: true, provider: "MPESA", reserved: true } });
      } catch (e) {
        await abortProcessing("PENDING", "M-Pesa payout failed to initiate — reserved funds returned");
        throw new ApiError(
          502,
          `M-Pesa payout could not be initiated — nothing was sent and the reservation was refunded. ${e instanceof Error ? e.message : ""}`,
          "PAYOUT_INIT_FAILED"
        );
      }
    }

    // Aborting a payout that already reserved funds → return them.
    if (withdrawal.status === "PROCESSING") {
      await abortProcessing(newStatus, `M-Pesa payout ${newStatus.toLowerCase()} — reserved funds returned`);
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

  // ── CRYPTO: claim → payout → finalize (debit only after initiation) ────
  let debited = false;
  if (isCrypto && newStatus === "COMPLETED") {
    if (!settings.cryptoPayoutApiKey) {
      throw new ApiError(
        503,
        "Crypto payout is not configured (crypto.payoutApiKey). Configure it — or REJECT this withdrawal and return the funds with a balance adjustment.",
        "PAYOUT_UNCONFIGURED"
      );
    }
    await beginProcessing();

    try {
      // If a previous attempt already initiated the payout (crash recovery),
      // skip straight to finalizing.
      const cur = await prisma.withdrawal.findUnique({ where: { id }, select: { metadata: true } });
      const curMeta = safeMeta(cur?.metadata);
      let payoutId = curMeta.payoutId ? Number(curMeta.payoutId) : null;
      if (!payoutId) {
        const payout = await npCreatePayout({
          address: withdrawal.destination,
          currency: withdrawal.currencyCode === "KES" ? "USDT" : withdrawal.currencyCode, // wallets hold KES → settle in USDT
          amount: amount / (settings.cryptoRates["USDT"] ?? 129),
        }).catch((e) => {
          throw new ApiError(502, `Crypto payout failed — no funds sent. ${e instanceof Error ? e.message : ""}`, "PAYOUT_FAILED");
        });
        payoutId = payout.withdrawals?.[0]?.id ?? null;
        // Persist immediately so a crash here can't cause a second payout.
        await prisma.withdrawal.update({
          where: { id },
          data: { metadata: JSON.stringify({ ...curMeta, payoutId }) },
        });
      }

      await prisma.$transaction(async (tx) => {
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
            metadata: JSON.stringify({ ...curMeta, payoutId }),
            processedAt: new Date(),
          },
        });
      });
    } catch (e) {
      // Nothing was debited — reset so the admin can retry or reject.
      await prisma.withdrawal.update({ where: { id }, data: { status: "PENDING" } });
      throw e;
    }
    debited = true;
    await notify(
      "Withdrawal Completed ✅",
      `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} is completed.`
    );
    await auditLog({
      admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
      prevValue: { status: withdrawal.status }, newValue: { status: newStatus, debited, provider: withdrawal.method },
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
