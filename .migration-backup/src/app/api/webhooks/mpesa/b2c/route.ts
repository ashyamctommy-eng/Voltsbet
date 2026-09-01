import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { creditWallet } from "@/lib/wallet";

/**
 * M-Pesa B2C payout callbacks — ResultURL (final result) and QueueTimeOutURL
 * both point here (with ?secret=). ResultCode 0 = money sent.
 *
 * Funds were already RESERVED when the admin marked the withdrawal PROCESSING
 * (atomic wallet debit). This callback only finalizes:
 *   - success → COMPLETED (no balance change — the debit happened at reserve)
 *   - failure → FAILED + the reserved funds are refunded to the wallet
 */
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  const s = await getSettings();
  if (!s.mpesaCallbackSecret || secret !== s.mpesaCallbackSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    Result?: {
      ResultCode?: number | string;
      ResultDesc?: string;
      ConversationID?: string;
      TransactionID?: string;
      OriginatorConversationID?: string;
    };
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const result = payload.Result ?? {};
  const conversationId = String(result.ConversationID ?? result.OriginatorConversationID ?? "");
  const resultCode = Number(result.ResultCode ?? -1);
  const resultDesc = String(result.ResultDesc ?? "");
  const transactionId = String(result.TransactionID ?? "");

  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Missing conversation id" }, { status: 400 });
  }

  const withdrawals = await prisma.withdrawal.findMany({ where: { method: "MPESA" } });
  const withdrawal = withdrawals.find((w) => {
    try {
      return JSON.parse(w.metadata ?? "{}").conversationId === conversationId;
    } catch {
      return false;
    }
  });
  if (!withdrawal) {
    return NextResponse.json({ ok: true, message: "Unknown conversation" });
  }
  if (withdrawal.status === "COMPLETED" || withdrawal.status === "FAILED" || withdrawal.status === "REJECTED" || withdrawal.status === "CANCELLED") {
    return NextResponse.json({ ok: true, message: "Already final" });
  }

  if (resultCode === 0) {
    // Payout succeeded — finalize. The wallet was already debited when the
    // payout was reserved (PROCESSING), so no balance change here.
    const claimed = await prisma.withdrawal.updateMany({
      where: { id: withdrawal.id, status: "PROCESSING" },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
        metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), transactionId, resultDesc }),
      },
    });
    if (claimed.count > 0) {
      await prisma.notification.create({
        data: {
          userId: withdrawal.userId, type: "WITHDRAWAL",
          title: "Withdrawal Completed ✅",
          message: `KSh ${Number(withdrawal.amount).toLocaleString()} sent to ${withdrawal.destination} via M-Pesa.`,
        },
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Failed / timed out → refund the reserved funds + FAILED. The atomic
  // PROCESSING → FAILED claim guarantees the refund happens exactly once
  // even if Safaricom retries the callback.
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawal.id, status: "PROCESSING" },
    data: {
      status: "FAILED",
      metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), resultCode, resultDesc }),
    },
  });
  if (claimed.count > 0) {
    await prisma.$transaction(async (tx) => {
      await creditWallet(tx, withdrawal.userId, Number(withdrawal.amount), {
        type: "WITHDRAWAL_REFUND",
        reason: `M-Pesa payout failed — reserved funds returned`,
        reference: withdrawal.id,
      });
      await tx.notification.create({
        data: {
          userId: withdrawal.userId, type: "WITHDRAWAL",
          title: "Withdrawal Failed",
          message: `Your M-Pesa payout could not be completed (${resultDesc || `code ${resultCode}`}). Reserved funds were returned to your balance.`,
        },
      });
    });
  }
  return NextResponse.json({ ok: true, failed: true });
}

function safeMeta(metadata: string | null): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}
