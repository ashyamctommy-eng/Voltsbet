import { NextRequest, NextResponse } from "next/server";
import { handle, requireAdmin, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { VOUCHER_STATUSES } from "@/lib/vouchers";

/**
 * GET /api/admin/vouchers/export — CSV export (requires SUPER_ADMIN, audited).
 *
 * IMPORTANT: full voucher codes are stored ONLY as sha256 hashes — they can
 * never be recovered from the DB. Full codes are exported ONCE at generation
 * time (the generate response → the admin UI offers CSV/print immediately).
 * This endpoint exports the durable metadata (masked display code, value,
 * currency, expiry, batch, status) for archival/reporting.
 */
export const GET = handle(async (req: NextRequest) => {
  const admin = await requireAdmin("vouchers");
  if (admin.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only super admins may export voucher data.", "ELEVATED_REQUIRED");
  }
  const sp = req.nextUrl.searchParams;
  const batchId = sp.get("batchId") ?? undefined;
  const status = sp.get("status") ?? undefined;

  const vouchers = await prisma.voucher.findMany({
    where: {
      ...(batchId ? { batchId } : {}),
      ...(status && VOUCHER_STATUSES.includes(status as never) ? { status } : {}),
    },
    include: { batch: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50_000,
  });

  await auditLog({
    admin,
    action: "VOUCHER_EXPORT",
    entity: "VOUCHER",
    prevValue: { scope: batchId ? `batch:${batchId}` : "all", status: status ?? "all", count: vouchers.length },
    newValue: null,
  });

  const rows = vouchers.map((v) => ({
    displayCode: v.displayCode,
    codeLast4: v.codeLast4,
    value: Number(v.value),
    currency: v.currency,
    expiry: v.expiresAt ? v.expiresAt.toISOString().slice(0, 10) : "",
    batch: v.batch?.name ?? "",
    status: v.status,
  }));

  const header = "display_code,last4,value,currency,expiry,batch,status";
  const csv =
    "\uFEFF" + // UTF-8 BOM so Excel renders headers correctly
    [header, ...rows.map((r) => [r.displayCode, r.codeLast4, r.value, r.currency, r.expiry, r.batch, r.status].join(","))].join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vouchers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
