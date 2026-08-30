import { NextRequest } from "next/server";
import { handle, ok, requireAdmin } from "@/lib/api";
import { listVouchers } from "@/lib/vouchers";

/**
 * GET /api/admin/vouchers — paginated voucher list with filters:
 *   ?status=&currency=&value=&batch=&q=&from=&to=&redeemedFrom=&redeemedTo=
 *    &page=&limit=&sort=&order=
 * Codes are masked; full codes never leave the server here.
 */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin("vouchers");
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : undefined;
  const to = sp.get("to") ? new Date(sp.get("to")!) : undefined;
  const redeemedFrom = sp.get("redeemedFrom") ? new Date(sp.get("redeemedFrom")!) : undefined;
  const redeemedTo = sp.get("redeemedTo") ? new Date(sp.get("redeemedTo")!) : undefined;

  const result = await listVouchers({
    status: sp.get("status") ?? undefined,
    currency: sp.get("currency") ?? undefined,
    value: sp.get("value") ? Number(sp.get("value")) : undefined,
    batchId: sp.get("batch") ?? undefined,
    q: sp.get("q") ?? undefined,
    from,
    to,
    redeemedFrom,
    redeemedTo,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    sort: (sp.get("sort") as "createdAt" | "redeemedAt" | "value" | "expiresAt") ?? undefined,
    order: (sp.get("order") as "asc" | "desc") ?? undefined,
  });
  return ok(result);
});
