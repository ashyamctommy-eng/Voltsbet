import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** GET /api/admin/voucher-batches/[id] — batch + its vouchers (masked). */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await sharedAdminGuard(req, "vouchers");
  const { id } = await ctx.params;
  const batch = await prisma.voucherBatch.findUnique({ where: { id } });
  if (!batch) throw new ApiError(404, "Batch not found.", "NOT_FOUND");

  const [vouchers, counts] = await Promise.all([
    prisma.voucher.findMany({
      where: { batchId: id },
      include: { redemption: { select: { userId: true, redeemedAt: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.voucher.groupBy({ by: ["status"], where: { batchId: id }, _count: { _all: true } }),
  ]);

  return ok({
    batch: {
      id: batch.id,
      name: batch.name,
      currency: batch.currency,
      value: Number(batch.value),
      quantity: batch.quantity,
      prefix: batch.prefix,
      notes: batch.notes,
      createdBy: batch.createdBy,
      createdAt: batch.createdAt,
    },
    statuses: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    vouchers: vouchers.map((v) => ({
      id: v.id,
      displayCode: v.displayCode,
      codeLast4: v.codeLast4,
      status: v.status,
      expiresAt: v.expiresAt,
      redeemedAt: v.redemption?.redeemedAt ?? null,
      redeemedBy: v.redemption?.userId ?? null,
    })),
  });
});
