import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { npCreatePayout } from "@/lib/providers/nowpayments";
import { mpesaB2c, publicBaseUrl } from "@/lib/providers/mpesa";
import { z } from "zod";

const schema = z.object({ status: z.string().min(1), adminNote: z.string().optional().default("") });

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

  // ── M-Pesa payout: PROCESSING → initiate B2C; the result callback finalizes ──
  if (withdrawal.method === "MPESA" && newStatus === "PROCESSING") {
    const base = publicBaseUrl(settings);
    const secret = settings.mpesaCallbackSecret;
    const resultUrl = `${base}/api/webhooks/mpesa/b2c?secret=${secret}`;
    const payout = await mpesaB2c({
      amount: Number(withdrawal.amount),
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
      prevValue: { status: withdrawal.status }, newValue: { status: "PROCESSING", provider: "MPESA", conversationId: payout.ConversationID },
    });
    return ok({ withdrawal: { id, status: "PROCESSING", payoutInitiated: true, provider: "MPESA" } });
  }

  // ── Crypto payout: COMPLETED → send via NOWPayments when configured ──
  if (withdrawal.method === "CRYPTO" && newStatus === "COMPLETED" && settings.cryptoPayoutApiKey) {
    const payout = await npCreatePayout({
      address: withdrawal.destination,
      currency: withdrawal.currencyCode === "KES" ? "USDT" : withdrawal.currencyCode, // wallets hold KES → settle in USDT
      amount: Number(withdrawal.amount) / (settings.cryptoRates["USDT"] ?? 129),
    }).catch((e) => {
      throw new ApiError(502, `Crypto payout failed — no funds sent. ${e.message}`, "PAYOUT_FAILED");
    });
    metadata.payoutId = payout.withdrawals?.[0]?.id ?? null;
  }

  // ── Debit + finalize (manual crypto, or after successful payout initiation) ──
  let debited = false;
  if (newStatus === "COMPLETED") {
    const result = await prisma.$transaction(async (tx) => {
      const wallet = withdrawal.user.wallet!;
      const prev = Number(wallet.balance);
      const amount = Number(withdrawal.amount);
      if (prev < amount) throw new ApiError(409, "Insufficient balance to complete this withdrawal.", "INSUFFICIENT_BALANCE");
      const next = Math.round((prev - amount) * 100) / 100;
      await tx.wallet.update({ where: { userId: withdrawal.userId }, data: { balance: next.toFixed(2) } });
      await tx.transaction.create({
        data: {
          userId: withdrawal.userId, type: "WITHDRAWAL", amount: (-amount).toFixed(2),
          currencyCode: withdrawal.currencyCode, prevBalance: prev.toFixed(2), newBalance: next.toFixed(2),
          reason: `Withdrawal to ${withdrawal.destination} (${withdrawal.method})`, reference: withdrawal.id,
        },
      });
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: newStatus,
          adminNote: parsed.data.adminNote || null,
          metadata: JSON.stringify(metadata),
          processedAt: new Date(),
        },
      });
      return { prev, next };
    });
    debited = true;
    void result;
  } else {
    await prisma.withdrawal.update({
      where: { id },
      data: { status: newStatus, adminNote: parsed.data.adminNote || null, metadata: JSON.stringify(metadata) },
    });
  }

  await prisma.notification.create({
    data: {
      userId: withdrawal.userId, type: "WITHDRAWAL",
      title: newStatus === "COMPLETED" ? "Withdrawal Completed ✅" : `Withdrawal ${newStatus.toLowerCase()}`,
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.currencyCode} is ${newStatus.toLowerCase()}.`,
    },
  });

  await auditLog({
    admin, action: "PAYMENT_STATUS_CHANGE", entity: "WITHDRAWAL", entityId: id, userId: withdrawal.userId,
    prevValue: { status: withdrawal.status }, newValue: { status: newStatus, debited, provider: withdrawal.method },
  });
  return ok({ withdrawal: { id, status: newStatus, debited } });
});
