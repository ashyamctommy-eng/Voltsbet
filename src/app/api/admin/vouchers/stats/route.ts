import { handle, ok, requireAdmin } from "@/lib/api";
import { voucherStats } from "@/lib/vouchers";

/** GET /api/admin/vouchers/stats — dashboard statistics + 30-day usage. */
export const GET = handle(async () => {
  await requireAdmin("vouchers");
  return ok({ stats: await voucherStats() });
});
