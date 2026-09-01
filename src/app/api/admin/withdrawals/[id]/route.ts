import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { npCreatePayout } from "@/lib/providers/nowpayments";
import { mpesaB2c, publicBaseUrl } from "@/lib/providers/mpesa";
import { palplusB2c } from "@/lib/providers/palplus";
import { creditWallet, toCents } from "@/lib/wallet";
import { cryptoAmountFor, convert } from "@/lib/currency";
import { z } from "zod";

const schema = z.object({
  status: z.string().min(1),
  adminNote: z.string().optional().default(""),
  payoutRef: z.string().optional().default(""), // external reference for manual payouts (tx hash, M-Pesa code…)
});

/**
 * Withdrawal state machine (manual-ops model):
 *
 * Funds are RESERVED AT CREATION (instant wallet debit in
 * /api/account/withdraw) — every PENDING withdrawal already holds its money.
 * Admin actions only finalize or release:
 *
 *   APPROVE  PENDING/VERIFICATION_REQUIRED → COMPLETED
 *            Manual path: requires an adminNote or payoutRef attesting how
 *            the money was sent (external tx hash, M-Pesa code…). No wallet
 *            movement — the reservation covered it.
 *            Crypto auto-payout: when crypto.payoutApiKey is configured and
 *            no payoutRef is given, the NOWPayments payout fires first; a
 *            failed payout leaves the withdrawal PENDING and reserved.
 *   REJECT   PENDING/VERIFICATION_REQUIRED/PROCESSING → REJECTED
 *            Reserved funds are refunded to the wallet — exactly once.
 *   PROCESSING (MPESA only) — fires the B2C payout; the callback completes
 *            (no balance change) or fails (FAILED + automatic refund).
 *
 * All transitions are claimed with atomic status-guarded updateMany calls so
 * two admins (or a webhook + an admin) can never double-refund or double-pay.
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
  if (!["COMPLETED", "REJECTED", "CANCELLED", "PROCESSING"].includes(newStatus)) {
    throw new ApiError(400, `Unsupported status transition: ${newStatus}.`, "BAD_STATUS");
  }

  const settings = await getSettings();
  let metadata = safeMeta(withdrawal.metadata);
  const amount = Number(withdrawal.amount);
  const isMpesa = withdrawal.method === "MPESA";
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
    // MPESA payouts already fired are finalized by the callback, not here.
    if (
      isMpesa &&
      withdrawal.status === "PROCESSING" &&
      (metadata.conversationId || metadata.transactionId)
    ) {
      throw new ApiError(
        409,
        "An M-Pesa payout is already in flight — wait for the callback to complete or fail it.",
        "PAYOUT_IN_FLIGHT"
      );
    }
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

  // ── MPESA: fire the B2C payout (funds already reserved at creation) ─────
  if (newStatus === "PROCESSING") {
    if (!isMpesa) {
      throw new ApiError(400, "PROCESSING is only used for M-Pesa B2C payouts.", "BAD_STATUS");
    }
    if (!settings.mpesaWithdrawalsEnabled) {
      throw new ApiError(503, "M-Pesa withdrawals are disabled (payments.mpesaWithdrawalsEnabled).", "MPESA_WITHDRAWALS_DISABLED");
    }
    const claimed = await prisma.withdrawal.updateMany({
      where: { id, status: { in: ["PENDING", "VERIFICATION_REQUIRED"] } },
      data: {
        status: "PROCESSING",
        metadata: JSON.stringify({ ...metadata, processingStartedAt: new Date().toISOString() }),
      },
    });
    if (claimed.count === 0) {
      throw new ApiError(409, "This payout is already being processed.", "ALREADY_PROCESSING");
    }
    metadata = { ...metadata, processingStartedAt: new Date().toISOString() };

    try {
      const base = publicBaseUrl(settings);
      // Explicit admin click → fire the B2C payout. Palpluss when configured
      // (PALPLUS_API_KEY), legacy Daraja otherwise.
      const usePalplus = Boolean(settings.palplusApiKey);
      const callbackUrl = usePalplus
        ? `${base}/api/webhooks/palplus`
        : `${base}/api/webhooks/mpesa/b2c?secret=${settings.mpesaCallbackSecret}`;
      // B2C pays in KES — convert non-KES wallet amounts via system rates.
      const kesAmount =
        withdrawal.currencyCode === "KES"
          ? amount
          : toCents(await convert(amount, withdrawal.currencyCode, "KES"));

      const payout = usePalplus
        ? await palplusB2c({
            amount: kesAmount,
            phone: withdrawal.destination,
            reference: ref,
            description: `UNIBET360 payout ${ref}`,
            callbackUrl,
          })
        : await mpesaB2c({
            amount: kesAmount,
            phone: withdrawal.destination,
            remarks: `UNIBET360 payout ${ref}`,
            resultUrl: callbackUrl,
            queueTimeOutUrl: callbackUrl,
          });
      // Persist the provider reference immediately — the callback matches on it.
      const palplusResult = payout as Awaited<ReturnType<typeof palplusB2c>>;
      const darajaResult = payout as Awaited<ReturnType<typeof mpesaB2c>>;
      const providerRef = usePalplus ? palplusResult.transactionId : darajaResult.ConversationID;
      await prisma.withdrawal.update({
        where: { id },
        data: {
          adminNote: parsed.data.adminNote || withdrawal.adminNote,
          metadata: JSON.stringify({
            ...metadata,
            provider: usePalplus ? "PALPLUS" : "MPESA",
            ...(usePalplus
              ? { transactionId: providerRef, palplus: palplusResult }
              : { conversationId: providerRef, originatorConversationId: darajaResult.OriginatorConversationID }),
            ...(withdrawal.currencyCode !== "KES" ? { kesAmount, walletAmount: amount } : {}),
          }),
        },
      });
      await auditLog({
        admin, action: "PAYOUT_INITIATED", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
        prevValue: { status: withdrawal.status, reserved: true },
        newValue: {
          status: "PROCESSING",
          provider: usePalplus ? "PALPLUS" : "MPESA",
          ...(usePalplus ? { transactionId: providerRef } : { conversationId: providerRef }),
        },
      });
      return ok({
        withdrawal: {
          id, status: "PROCESSING", payoutInitiated: true,
          provider: usePalplus ? "PALPLUS" : "MPESA", reserved: true,
        },
      });
    } catch (e) {
      // Initiation failed — no money moved. Back to PENDING (still reserved).
      await prisma.withdrawal.update({
        where: { id },
        data: { status: "PENDING", metadata: JSON.stringify({ ...metadata, processingStartedAt: null }) },
      });
      throw new ApiError(
        502,
        `M-Pesa payout could not be initiated — nothing was sent and the withdrawal is back to pending. ${e instanceof Error ? e.message : ""}`,
        "PAYOUT_INIT_FAILED"
      );
    }
  }

  // ── APPROVE → COMPLETED (manual payout attestation) ─────────────────────
  if (newStatus === "COMPLETED") {
    // M-Pesa completes via the B2C callback OR explicit manual attestation
    // ("Approve & mark paid" with a payout reference/note). Never automatic.
    if (isMpesa && !parsed.data.payoutRef && !parsed.data.adminNote) {
      throw new ApiError(
        409,
        "M-Pesa withdrawals complete via the B2C callback (use PROCESSING / Approve via Palplus B2C) or with a manual payout reference.",
        "USE_PROCESSING"
      );
    }

    // Crypto auto-payout path when a payout key is configured and the admin
    // hasn't attested a manual transfer. Funds stay reserved either way.
    let payoutId: number | null = null;
    if (settings.cryptoPayoutApiKey && !parsed.data.payoutRef) {
      // Currency-aware payout amount: KES wallets settle in USDT at the
      // configured KES-per-coin rate; USD/USDT wallets get 1:1; any other
      // wallet converts through the currency table (cryptoAmountFor).
      const wc = withdrawal.currencyCode.toUpperCase();
      const payoutCoin = wc === "KES" || wc === "USD" || wc === "USDT" ? "USDT" : wc;
      const payoutAmount = await cryptoAmountFor(amount, wc, payoutCoin, settings.cryptoRates);
      if (payoutAmount == null) {
        throw new ApiError(
          502,
          `Crypto payout not initiated — no exchange rate for ${wc} → ${payoutCoin}. Check Admin → Website Settings → Crypto rates / currencies.`,
          "PAYOUT_RATE_MISSING"
        );
      }
      try {
        const payout = await npCreatePayout({
          address: withdrawal.destination,
          currency: payoutCoin,
          amount: payoutAmount,
        });
        payoutId = payout.withdrawals?.[0]?.id ?? null;
      } catch (e) {
        throw new ApiError(502, `Crypto payout failed — no funds sent. ${e instanceof Error ? e.message : ""}`, "PAYOUT_FAILED");
      }
    } else if (!parsed.data.payoutRef && !parsed.data.adminNote) {
      // Manual completion with no provider and no paper trail is refused —
      // the admin must record HOW the player was paid.
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
        metadata: JSON.stringify({ ...metadata, ...(payoutId ? { payoutId } : {}), ...(parsed.data.payoutRef ? { payoutRef: parsed.data.payoutRef } : {}) }),
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
      newValue: { status: newStatus, provider: withdrawal.method, payoutId, payoutRef: parsed.data.payoutRef || undefined, manual: !payoutId },
    });
    return ok({ withdrawal: { id, status: newStatus, reserved: true } });
  }

  throw new ApiError(400, "Unsupported transition.", "BAD_STATUS");
});
