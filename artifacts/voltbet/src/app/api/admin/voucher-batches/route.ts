import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { listVoucherBatches } from "@/lib/vouchers";

/** GET /api/admin/voucher-batches — batch list with per-status counts. */
export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "vouchers");
  return ok({ batches: await listVoucherBatches() });
});
