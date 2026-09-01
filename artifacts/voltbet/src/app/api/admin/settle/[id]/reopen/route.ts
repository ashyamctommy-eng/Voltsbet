import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { reopenOutcome } from "@/lib/settle";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "settlements");
  const { id } = await ctx.params;
  return ok(await reopenOutcome(admin, id));
});
