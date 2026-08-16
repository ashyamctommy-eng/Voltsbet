import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ status: z.string().min(1) });

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("deposits");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const deposit = await prisma.deposit.findUnique({ where: { id }, include: { user: { include: { wallet: true } } } });
  if (!deposit) throw new ApiError(404, "Deposit not found.", "NOT_FOUND");

  const newStatus = parsed.data.status;
  if (deposit.status === "COMPLETED" && newStatus !== "COMPLETED") {
    throw new ApiError(409, "Completed deposits cannot be changed.", "LOCKED");
  }

  // Completing a deposit that was never credited → credit the wallet atomically.
  let credited = false;
  if (newStatus === "COMPLETED" && deposit.status !== "COMPLETED") {
    await prisma.$transaction(async (tx) => {
      const wallet = deposit.user.wallet!;
      const prev = Number(wallet.balance);
      const amount = Number(deposit.amount);
      const next = Math.round((prev + amount) * 100) / 100;
      await tx.wallet.update({ where: { userId: deposit.userId }, data: { balance: next.toFixed(2) } });
      await tx.transaction.create({
        data: {
          userId: deposit.userId, type: "DEPOSIT", amount: amount.toFixed(2),
          currencyCode: deposit.currencyCode, prevBalance: prev.toFixed(2), newBalance: next.toFixed(2),
          reason: `Crypto deposit ${deposit.cryptoCurrency ?? ""} (manual confirmation)`, reference: deposit.id,
        },
      });
      await tx.deposit.update({ where: { id }, data: { status: newStatus, confirmedAt: new Date() } });
    });
    credited = true;
  } else {
    await prisma.deposit.update({ where: { id }, data: { status: newStatus } });
  }

  await auditLog({
    admin, action: "PAYMENT_STATUS_CHANGE", entity: "DEPOSIT", entityId: id, userId: deposit.userId,
    prevValue: { status: deposit.status }, newValue: { status: newStatus, credited },
  });
  return ok({ deposit: { id, status: newStatus, credited } });
});
