import { NextRequest } from "next/server";
import { handle, ok, auditLog, sharedAdminGuard } from "@/lib/api";
import { syncMarketRates } from "@/lib/rates";

/**
 * POST /api/admin/currencies/sync — manually trigger the market-rate sync
 * (fiat + crypto) from the admin panel. Same engine as /api/cron/rates.
 */
export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "currencies");
  const result = await syncMarketRates();
  await auditLog({
    admin,
    action: "RATES_SYNC",
    entity: "CURRENCY",
    newValue: result,
  });
  return ok(result);
});
