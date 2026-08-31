import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";
import { creditWallet } from "@/lib/wallet";
import { verifyPalplusWebhook } from "@/lib/providers/palplus";

/**
 * POST /api/webhooks/palplus — Palplus gateway callback (deposits AND B2C).
 *
 * Deposits: STK Push result → confirmDeposit on success (atomic credit,
 * exactly-once). B2C withdrawals: payout result → finalize PROCESSING rows
 * (COMPLETED on success — funds were debited at reserve; FAILED + refund on
 * failure). The body is signed with the webhook secret (see
 * verifyPalplusWebhook); a ?secret= query fallback is also accepted.
 *
 * Success codes: "0" / "00" / SUCCESS / COMPLETED / PAID.
 */
function safeMeta(metadata: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
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

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const checkoutRequestId = String(
    payload.checkoutRequestId ?? payload.CheckoutRequestID ?? payload.merchantRequestId ?? "",
  );
  const conversationId = String(
    payload.conversationId ?? payload.ConversationID ?? payload.originatorConversationId ?? "",
  );
  const resultCode = String(payload.resultCode ?? payload.ResultCode ?? payload.status ?? "");
  const receipt = String(payload.mpesaReceiptNumber ?? payload.MpesaReceiptNumber ?? payload.receipt ?? payload.transactionId ?? "");
  const paid =
    resultCode === "0" ||
    resultCode === "00" ||
    /^(success|completed|paid)$/i.test(resultCode);

  if (!checkoutRequestId && !conversationId) {
    return NextResponse.json({ ok: false, error: "Missing callback reference" }, { status: 400 });
  }

  // ── B2C withdrawal callback (matched on conversation/merchant reference) ──
  if (conversationId || !checkoutRequestId) {
    const withdrawals = await prisma.withdrawal.findMany({ where: { method: "MPESA" } });
    const withdrawal = withdrawals.find((w) => {
      const m = safeMeta(w.metadata);
      return (
        m.conversationId === conversationId ||
        m.conversationId === checkoutRequestId ||
        m.merchantRequestId === checkoutRequestId
      );
    });
    if (withdrawal) {
      if (["COMPLETED", "FAILED", "REJECTED", "CANCELLED"].includes(withdrawal.status)) {
        return NextResponse.json({ ok: true, message: "Already final" });
      }
      if (paid) {
        const claimed = await prisma.withdrawal.updateMany({
          where: { id: withdrawal.id, status: "PROCESSING" },
          data: {
            status: "COMPLETED",
            processedAt: new Date(),
            metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), transactionId: receipt, provider: "PALPLUS" }),
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
        // Payout failed — flip to FAILED and refund the reservation exactly once.
        const claimed = await prisma.withdrawal.updateMany({
          where: { id: withdrawal.id, status: "PROCESSING" },
          data: { status: "FAILED", metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), resultCode, provider: "PALPLUS" }) },
        });
        if (claimed.count > 0 && safeMeta(withdrawal.metadata).reserved === true && safeMeta(withdrawal.metadata).refunded !== true) {
          await prisma.$transaction(async (tx) => {
            await creditWallet(tx, withdrawal.userId, Number(withdrawal.amount), {
              type: "WITHDRAWAL_REFUND",
              method: "MPESA",
              reason: `Payout failed (${withdrawal.trackingId ?? withdrawal.id}) — reserved funds returned`,
              reference: withdrawal.trackingId ?? withdrawal.id,
            });
            await tx.withdrawal.update({
              where: { id: withdrawal.id },
              data: { metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), refunded: true }) },
            });
          });
        }
      }
      return NextResponse.json({ ok: true });
    }
  }

  // ── STK deposit callback ───────────────────────────────────────────────
  if (checkoutRequestId) {
    const deposits = await prisma.deposit.findMany({ where: { method: "MPESA" } });
    const deposit = deposits.find((d) => {
      const m = safeMeta(d.metadata);
      return m.checkoutRequestId === checkoutRequestId || m.merchantRequestId === checkoutRequestId;
    });
    if (!deposit) {
      return NextResponse.json({ ok: true, message: "Unknown checkout" });
    }
    if (paid) {
      await confirmDeposit(deposit.id, { txHash: receipt || undefined, providerRef: checkoutRequestId });
    } else {
      await updateDepositStatus(deposit.id, "FAILED").catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, message: "Unknown callback" });
}
