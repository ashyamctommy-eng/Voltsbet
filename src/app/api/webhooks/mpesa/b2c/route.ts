import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

/**
 * M-Pesa B2C payout callbacks — ResultURL (final result) and QueueTimeOutURL
 * both point here (with ?secret=). ResultCode 0 = money sent.
 *
 * The withdrawal was created as PROCESSING when the payout was initiated
 * (conversationId stored in metadata). On success we debit the wallet + mark
 * COMPLETED; on failure/timeout we mark FAILED without debiting.
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
    // Payout succeeded → debit the wallet atomically + complete.
    const outcome = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
      if (!wallet) throw new Error("no wallet");
      const prev = Number(wallet.balance);
      const amount = Number(withdrawal.amount);
      if (prev < amount) throw new Error("insufficient balance");
      const next = Math.round((prev - amount) * 100) / 100;
      await tx.wallet.update({ where: { userId: withdrawal.userId }, data: { balance: next.toFixed(2) } });
      await tx.transaction.create({
        data: {
          userId: withdrawal.userId, type: "WITHDRAWAL", amount: (-amount).toFixed(2),
          currencyCode: withdrawal.currencyCode, prevBalance: prev.toFixed(2), newBalance: next.toFixed(2),
          reason: `M-Pesa payout to ${withdrawal.destination}`, reference: withdrawal.id,
        },
      });
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: "COMPLETED",
          processedAt: new Date(),
          metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), transactionId, resultDesc }),
        },
      });
      await tx.notification.create({
        data: {
          userId: withdrawal.userId, type: "WITHDRAWAL",
          title: "Withdrawal Completed ✅",
          message: `KSh ${Number(withdrawal.amount).toLocaleString()} sent to ${withdrawal.destination} via M-Pesa.`,
        },
      });
      return { prev, next };
    });
    return NextResponse.json({ ok: true, outcome });
  }

  // Failed / timed out → FAILED, no debit.
  await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: { status: "FAILED", metadata: JSON.stringify({ ...safeMeta(withdrawal.metadata), resultCode, resultDesc }) },
  });
  await prisma.notification.create({
    data: {
      userId: withdrawal.userId, type: "WITHDRAWAL",
      title: "Withdrawal Failed",
      message: `Your M-Pesa payout could not be completed (${resultDesc || `code ${resultCode}`}). No funds were debited.`,
    },
  });
  return NextResponse.json({ ok: true, failed: true });
}

function safeMeta(metadata: string | null): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}
