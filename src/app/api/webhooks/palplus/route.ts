import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";
import { creditWallet } from "@/lib/wallet";
import { verifyPalplusWebhook } from "@/lib/providers/palplus";

/**
 * POST /api/webhooks/palplus — PalPluss gateway callback (STK deposits AND B2C).
 *
 * PalPluss POSTs the terminal transaction payload to the callbackUrl we supply
 * at initiation. We append ?secret=<webhookSecret> to that URL, so a missing
 * or wrong secret is rejected here (401). Payload shape (docs.palpluss.com):
 *
 *   { "event": "transaction.updated",
 *     "event_type": "transaction.success" | "transaction.failed" |
 *                   "transaction.cancelled" | "transaction.expired",
 *     "transaction": { "id": "<uuid>", "type": "STK"|"B2C",
 *       "status": "SUCCESS"|"FAILED"|"CANCELLED"|"EXPIRED",
 *       "amount": 1000, "currency": "KES", "phone_number": "254712345678",
 *       "external_reference": "<accountReference|reference>",
 *       "mpesa_receipt": "LGR019G3J2"|null, "result_code": "0",
 *       "result_desc": "...", ... } }
 *
 * Matching: deposits by metadata.transactionId (= PalPluss transaction.id),
 * providerCheckoutId, or external_reference; withdrawals by
 * metadata.transactionId, trackingId or id == external_reference.
 * Exactly-once: every finalization is guarded by status (updateMany where
 * status is still pending/PROCESSING) and the webhook may be redelivered.
 */
type Tx = {
  id?: string;
  type?: string;
  status?: string;
  amount?: number;
  external_reference?: string | null;
  mpesa_receipt?: string | null;
  result_code?: string | null;
  result_desc?: string | null;
  provider_checkout_id?: string | null;
};

function safeMeta(metadata: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}

function isSuccess(tx: Tx, eventType: string): boolean {
  return (
    eventType === "transaction.success" ||
    tx.status === "SUCCESS" ||
    tx.result_code === "0" ||
    tx.result_code === "00"
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const querySecret = req.nextUrl.searchParams.get("secret");
  const signature =
    req.headers.get("x-palplus-signature") ??
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-signature");

  const ok = await verifyPalplusWebhook(rawBody, signature, querySecret);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: { event?: string; event_type?: string; transaction?: Tx };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const tx = payload.transaction ?? {};
  const eventType = payload.event_type ?? "";
  if (!tx.id || payload.event !== "transaction.updated") {
    return NextResponse.json({ ok: true, message: "Ignored — not a transaction.updated event" });
  }
  const txId = String(tx.id);
  const paid = isSuccess(tx, eventType);

  // ── 1. B2C payout result (withdrawal) ────────────────────────────────────
  if (tx.type === "B2C") {
    const externalRef = tx.external_reference ?? null;
    const withdrawals = await prisma.withdrawal.findMany({
      where: { method: "MPESA" },
      select: { id: true, userId: true, amount: true, currencyCode: true, trackingId: true, status: true, metadata: true },
    });
    const withdrawal = withdrawals.find((w) => {
      const m = safeMeta(w.metadata);
      return (
        m.transactionId === txId ||
        (tx.provider_checkout_id != null && m.providerCheckoutId === tx.provider_checkout_id) ||
        (externalRef !== null && (w.trackingId === externalRef || w.id === externalRef))
      );
    });

    if (!withdrawal) {
      return NextResponse.json({ ok: true, message: "No matching withdrawal" });
    }
    if (["COMPLETED", "FAILED", "REJECTED", "CANCELLED"].includes(withdrawal.status)) {
      return NextResponse.json({ ok: true, message: "Already final" });
    }
    const meta = safeMeta(withdrawal.metadata);

    if (paid) {
      const claimed = await prisma.withdrawal.updateMany({
        where: { id: withdrawal.id, status: "PROCESSING" },
        data: {
          status: "COMPLETED",
          processedAt: new Date(),
          metadata: JSON.stringify({
            ...meta,
            provider: "PALPLUS",
            transactionId: txId,
            mpesaReceipt: tx.mpesa_receipt ?? null,
            resultCode: tx.result_code ?? null,
          }),
        },
      });
      if (claimed.count > 0) {
        await prisma.notification.create({
          data: {
            userId: withdrawal.userId,
            type: "WITHDRAWAL",
            title: "Withdrawal Completed ✅",
            message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} (${withdrawal.trackingId ?? withdrawal.id}) was sent via M-Pesa.`,
          },
        });
      }
    } else {
      // Payout failed — flip to FAILED and refund the reservation exactly once
      // (funds were debited from the user at request time; PalPluss reverses
      // its own wallet automatically — we must mirror that for the user).
      const claimed = await prisma.withdrawal.updateMany({
        where: { id: withdrawal.id, status: "PROCESSING" },
        data: {
          status: "FAILED",
          metadata: JSON.stringify({
            ...meta,
            provider: "PALPLUS",
            transactionId: txId,
            resultCode: tx.result_code ?? null,
            resultDesc: tx.result_desc ?? null,
          }),
        },
      });
      if (claimed.count > 0 && meta.reserved === true && meta.refunded !== true) {
        await prisma.$transaction(async (txc) => {
          await creditWallet(txc, withdrawal.userId, Number(withdrawal.amount), {
            type: "WITHDRAWAL_REFUND",
            method: "MPESA",
            reason: `Payout failed (${withdrawal.trackingId ?? withdrawal.id}) — reserved funds returned`,
            reference: withdrawal.trackingId ?? withdrawal.id,
          });
          await txc.withdrawal.update({
            where: { id: withdrawal.id },
            data: { metadata: JSON.stringify({ ...meta, refunded: true }) },
          });
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── 2. STK Push result (deposit) ─────────────────────────────────────────
  if (tx.type === "STK") {
    const externalRef = tx.external_reference ?? null;
    const deposits = await prisma.deposit.findMany({
      where: { method: "MPESA" },
      select: { id: true, metadata: true, status: true },
    });
    const deposit = deposits.find((d) => {
      const m = safeMeta(d.metadata);
      return (
        m.transactionId === txId ||
        (tx.provider_checkout_id != null && m.providerCheckoutId === tx.provider_checkout_id) ||
        (externalRef !== null && m.accountReference === externalRef)
      );
    });
    if (!deposit) {
      return NextResponse.json({ ok: true, message: "No matching deposit" });
    }
    if (paid) {
      await confirmDeposit(deposit.id, {
        txHash: tx.mpesa_receipt ?? undefined,
        providerRef: txId,
      });
    } else {
      await updateDepositStatus(deposit.id, "FAILED").catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, message: "Unknown transaction type" });
}
