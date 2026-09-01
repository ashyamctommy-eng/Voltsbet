import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { voucherStats } from "@/lib/vouchers";

/** GET /api/admin/vouchers/stats — dashboard statistics + 30-day usage. */
export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "vouchers");
  return ok({ stats: await voucherStats() });
});
