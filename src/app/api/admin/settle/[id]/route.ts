import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, ApiError } from "@/lib/api";
import { settleOutcome } from "@/lib/settle";
import { z } from "zod";

const schema = z.object({ result: z.enum(["WON", "LOST", "VOID"]) });

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("settlements");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const result = await settleOutcome(admin, id, parsed.data.result);
  return ok(result);
});
