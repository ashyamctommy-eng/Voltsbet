import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";
import { z } from "zod";

const schema = z.object({ status: z.string().min(1) });

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("deposits");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const deposit = await prisma.deposit.findUnique({ where: { id }, include: { user: true } });
  if (!deposit) throw new ApiError(404, "Deposit not found.", "NOT_FOUND");

  const newStatus = parsed.data.status;
  if (deposit.status === "COMPLETED" && newStatus !== "COMPLETED") {
    throw new ApiError(409, "Completed deposits cannot be changed.", "LOCKED");
  }

  // Completing a deposit funnels through the shared atomic confirmDeposit
  // path (status claim → wallet credit → transaction → notification →
  // referral bonus), so webhook + admin can never double-credit. Manual
  // override lets an admin complete a deposit stuck in a non-creditable
  // status (e.g. FAILED after a late provider confirmation) — still
  // exactly-once because COMPLETED is terminal.
  let credited = false;
  if (newStatus === "COMPLETED") {
    const res = await confirmDeposit(id, {}, deposit.status !== "COMPLETED");
    credited = !res.alreadyCompleted;
  } else {
    await updateDepositStatus(id, newStatus);
  }

  await auditLog({
    admin, action: "PAYMENT_STATUS_CHANGE", entity: "DEPOSIT", entityId: id, userId: deposit.userId,
    prevValue: { status: deposit.status }, newValue: { status: newStatus, credited },
  });
  return ok({ deposit: { id, status: newStatus, credited } });
});
