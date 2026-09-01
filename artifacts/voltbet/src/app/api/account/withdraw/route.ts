import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isUserActionAllowed, userBlockReason } from "@/lib/statuses";
import { debitWallet } from "@/lib/wallet";
import { z } from "zod";

const schema = z.object({
  amount: z.number().positive("Enter an amount"),
  method: z.enum(["CRYPTO", "MPESA"]).optional().default("CRYPTO"),
  destination: z.string().min(3, "Enter your payment destination (e.g. wallet address or M-Pesa number)"),
});

/** Human-friendly tracking reference: WD-2026-XXXX (unique, collision-retried). */
async function mintTrackingId(): Promise<string> {
  const year = new Date().getFullYear();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  for (let i = 0; i < 8; i++) {
    const suffix = Array.from(randomBytes(4)).map((b) => alphabet[b % alphabet.length]).join("");
    const candidate = `WD-${year}-${suffix}`;
    const clash = await prisma.withdrawal.findUnique({ where: { trackingId: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw new ApiError(500, "Could not allocate a tracking ID. Please retry.", "TRACKING_ID_FAILED");
}

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
    if (!settings.mpesaWithdrawalsEnabled) {
      throw new ApiError(503, "M-Pesa withdrawals are not enabled. Please use crypto or contact support.", "MPESA_WITHDRAWALS_DISABLED");
    }
    const { normalizeMpesaPhone } = await import("@/lib/providers/mpesa");
    destination = normalizeMpesaPhone(destination);
  }

  const trackingId = await mintTrackingId();
  const dest = method === "MPESA" ? destination.replace(/\s/g, "") : destination;

  // Instant fund reservation: the wallet debit, the ledger row and the
  // withdrawal record land in ONE transaction — a created withdrawal ALWAYS
  // holds its funds, so approval can never overdraw the account and the
  // user can't double-spend money that's already spoken for.
  const withdrawal = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
    if (Number(wallet.balance) < amount) {
      throw new ApiError(400, "Insufficient balance for this withdrawal.", "INSUFFICIENT_BALANCE");
    }

    const created = await tx.withdrawal.create({
      data: {
        trackingId,
        userId: user.id,
        amount: amount.toFixed(2),
        currencyCode: wallet.currencyCode,
        method,
        destination: dest,
        status: "PENDING",
        metadata: JSON.stringify({ reserved: true, reservedAt: new Date().toISOString() }),
      },
    });

    await debitWallet(tx, user.id, amount, {
      type: "WITHDRAWAL",
      method,
      reason: `Withdrawal ${trackingId} reserved — pending review`,
      reference: trackingId,
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        type: "WITHDRAWAL",
        title: "Withdrawal Requested",
        message: `Your withdrawal of ${amount} (${trackingId}) is pending review. The amount has been reserved from your balance.`,
      },
    });

    return created;
  });

  return ok({
    withdrawal: {
      id: withdrawal.id,
      trackingId: withdrawal.trackingId,
      status: withdrawal.status,
      method,
      reserved: true,
    },
  });
});
