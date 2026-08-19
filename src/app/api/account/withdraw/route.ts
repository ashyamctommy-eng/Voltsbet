import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isUserActionAllowed, userBlockReason } from "@/lib/statuses";
import { z } from "zod";

const schema = z.object({
  amount: z.number().positive("Enter an amount"),
  method: z.enum(["CRYPTO", "MPESA"]).optional().default("CRYPTO"),
  destination: z.string().min(3, "Enter your payment destination (e.g. wallet address or M-Pesa number)"),
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();

  if (!(await isUserActionAllowed(user.status, "withdraw"))) {
    const reason = await userBlockReason(user.status, "withdraw");
    throw new ApiError(403, reason ?? "Withdrawals are currently disabled for your account.", "WITHDRAW_LOCKED");
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const { amount, method } = parsed.data;
  let destination = parsed.data.destination;

  const settings = await getSettings();
  if (amount < settings.minStake) {
    throw new ApiError(400, `Minimum withdrawal is ${settings.minStake}.`, "MIN_AMOUNT");
  }

  if (method === "MPESA") {
    if (!settings.mpesaEnabled) throw new ApiError(503, "M-Pesa payouts are not enabled yet.", "MPESA_DISABLED");
    const { normalizeMpesaPhone } = await import("@/lib/providers/mpesa");
    destination = normalizeMpesaPhone(destination);
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
  if (Number(wallet.balance) < amount) {
    throw new ApiError(400, "Insufficient balance for this withdrawal.", "INSUFFICIENT_BALANCE");
  }

  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId: user.id,
      amount: amount.toFixed(2),
      currencyCode: wallet.currencyCode,
      method,
      destination: method === "MPESA" ? destination.replace(/\s/g, "") : destination,
      status: "PENDING",
    },
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      type: "WITHDRAWAL",
      title: "Withdrawal Requested",
      message: `Your withdrawal of ${amount} is pending review.`,
    },
  });

  return ok({ withdrawal: { id: withdrawal.id, status: withdrawal.status, method } });
});
