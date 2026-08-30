import { handle, ok, requireAdmin } from "@/lib/api";
import { listVoucherBatches } from "@/lib/vouchers";

/** GET /api/admin/voucher-batches — batch list with per-status counts. */
export const GET = handle(async () => {
  await requireAdmin("vouchers");
  return ok({ batches: await listVoucherBatches() });
});
