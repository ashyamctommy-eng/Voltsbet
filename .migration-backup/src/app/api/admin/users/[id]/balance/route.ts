import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { adjustBalance } from "@/lib/settle";
import { z } from "zod";

const schema = z.object({
  amount: z.number(),
  reason: z.string().min(3, "Provide a reason (audited)"),
});

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "transactions");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const result = await adjustBalance(admin, id, parsed.data.amount, parsed.data.reason);
  return ok({ transaction: result });
});
