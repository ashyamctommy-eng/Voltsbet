import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf } from "@/lib/api";
import { reopenOutcome } from "@/lib/settle";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("settlements");
  const { id } = await ctx.params;
  return ok(await reopenOutcome(admin, id));
});
