import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { approveWithdrawal } from "@/lib/withdrawal-service";

/**
 * POST /api/admin/withdrawals/[id]/approve
 *
 * Single-click approval: PENDING → COMPLETED via an atomic status-guarded
 * update. No manual payout reference is required — the auto-assigned
 * PLP-WDR-* reference code is the audit trail and funds were already
 * reserved at request creation.
 */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "withdrawals");
  const { id } = await ctx.params;
  const withdrawal = await approveWithdrawal(admin, id);
  return ok({ withdrawal });
});
