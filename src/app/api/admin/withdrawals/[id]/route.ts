import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { rejectWithdrawal } from "@/lib/withdrawal-service";
import { z } from "zod";

const schema = z.object({
  status: z.string().min(1),
  adminNote: z.string().optional().default(""),
});

/**
 * PATCH /api/admin/withdrawals/[id]
 *
 * Reject / cancel a withdrawal — atomic status claim + exactly-once refund
 * of the reserved funds (see withdrawal-service.ts). Approval has its own
 * endpoint: POST /api/admin/withdrawals/[id]/approve.
 */
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "withdrawals");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  if (parsed.data.status !== "REJECTED" && parsed.data.status !== "CANCELLED") {
    throw new ApiError(
      400,
      `Unsupported status transition: ${parsed.data.status}. Use POST .../approve to complete a withdrawal.`,
      "BAD_STATUS",
    );
  }

  const withdrawal = await rejectWithdrawal(admin, id, parsed.data.status);

  // Persist the admin's note (rejection reason) after the atomic transition.
  if (parsed.data.adminNote) {
    await prisma.withdrawal.update({ where: { id }, data: { adminNote: parsed.data.adminNote } });
  }

  return ok({ withdrawal });
});
