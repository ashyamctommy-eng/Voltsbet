import { NextRequest } from "next/server";
import { handle, ok, auditLog, sharedAdminGuard } from "@/lib/api";
import { autoSettleFinishedGames } from "@/lib/auto-settle";

/**
 * POST /api/admin/settle — MANUAL bulk settlement trigger for the admin
 * panel ("⚡ Settle Bets"). Runs the same engine as the /api/cron/settle
 * job: finds FINISHED games past the settlement delay, resolves every
 * unsettled outcome it can determine with certainty, and settles the
 * affected bets (WON/LOST/VOID, payouts credited) atomically inside a
 * Prisma transaction. Unresolvable outcomes stay for admin review.
 */
export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "settlements");
  const result = await autoSettleFinishedGames();
  await auditLog({
    admin,
    action: "SETTLE",
    entity: "BETS",
    newValue: { ...result, at: new Date().toISOString() },
  });
  return ok({
    ...result,
    message: `${result.betsSettled} bet(s) settled (${result.settled.length} outcomes resolved, ${result.skipped.length} awaiting review)`,
  });
});
