import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { updateVoucherStatus } from "@/lib/vouchers";
import { z } from "zod";

/**
 * Voucher detail + status management:
 *   GET  /api/admin/vouchers/[id] → full detail incl. redemption + audit trail
 *   POST /api/admin/vouchers/[id] → { action: cancel | suspend | reactivate }
 */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await sharedAdminGuard(req, "vouchers");
  const { id } = await ctx.params;
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: {
      batch: true,
      redemption: { include: { voucher: false } },
    },
  });
  if (!voucher) throw new ApiError(404, "Voucher not found.", "NOT_FOUND");

  const redeemedByUser = voucher.redeemedById
    ? await prisma.user.findUnique({ where: { id: voucher.redeemedById }, select: { username: true, email: true } })
    : null;
  const createdByUser = voucher.createdById
    ? await prisma.user.findUnique({ where: { id: voucher.createdById }, select: { username: true } })
    : null;
  const audit = await prisma.auditLog.findMany({
    where: { entity: "VOUCHER", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const redemptionTxn = voucher.redemption?.transactionId
    ? await prisma.transaction.findUnique({ where: { id: voucher.redemption.transactionId } })
    : null;

  return ok({
    voucher: {
      id: voucher.id,
      displayCode: voucher.displayCode,
      codeLast4: voucher.codeLast4,
      value: Number(voucher.value),
      currency: voucher.currency,
      status: voucher.status,
      batchId: voucher.batchId,
      batchName: voucher.batch?.name ?? null,
      notes: voucher.notes,
      createdAt: voucher.createdAt,
      createdBy: createdByUser?.username ?? null,
      expiresAt: voucher.expiresAt,
      redeemedAt: voucher.redeemedAt,
      redeemedBy: redeemedByUser ? { id: voucher.redeemedById, username: redeemedByUser.username, email: redeemedByUser.email } : null,
      cancelledAt: voucher.cancelledAt,
      cancelledBy: voucher.cancelledBy,
      suspendedAt: voucher.suspendedAt,
      suspendedBy: voucher.suspendedBy,
      redemption: voucher.redemption
        ? {
            amount: Number(voucher.redemption.amount),
            currency: voucher.redemption.currency,
            redeemedAt: voucher.redemption.redeemedAt,
            ipAddress: voucher.redemption.ipAddress,
            deviceInfo: voucher.redemption.deviceInfo,
            transactionId: redemptionTxn?.reference ?? null,
          }
        : null,
    },
    audit: audit.map((a) => ({
      id: a.id,
      action: a.action,
      adminName: a.adminName,
      userId: a.userId,
      ip: a.ip,
      prevValue: a.prevValue,
      newValue: a.newValue,
      createdAt: a.createdAt,
    })),
  });
});

const statusSchema = z.object({
  action: z.enum(["cancel", "suspend", "reactivate"]),
});

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "vouchers");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid action.", "VALIDATION");

  const target =
    parsed.data.action === "cancel" ? "CANCELLED" : parsed.data.action === "suspend" ? "SUSPENDED" : "UNUSED";
  const result = await updateVoucherStatus(admin, id, target);
  return ok(result);
});
