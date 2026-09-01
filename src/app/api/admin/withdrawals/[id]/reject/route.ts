import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard, ApiError } from "@/lib/api";
import { rejectWithdrawal } from "@/lib/withdrawal-service";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["REJECTED", "CANCELLED"]).optional().default("REJECTED"),
});

/**
 * POST /api/admin/withdrawals/[id]/reject
 *
 * Rejection with exactly-once refund: the status claim and the wallet credit
 * run inside ONE transaction, so two concurrent rejections can never refund
 * the same reservation twice.
 */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "withdrawals");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const withdrawal = await rejectWithdrawal(admin, id, parsed.data.status);
  return ok({ withdrawal });
});
