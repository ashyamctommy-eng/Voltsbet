import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { placeBet } from "@/lib/bet-engine";
import { z } from "zod";

const schema = z.object({
  selections: z
    .array(z.object({ outcomeId: z.string().min(1), oddsAtPlacement: z.number() }))
    .min(1),
  stake: z.number(),
  type: z.enum(["SINGLE", "MULTIPLE"]),
  acceptOddsChange: z.boolean().optional().default(false),
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  }
  const result = await placeBet(user, {
    ...parsed.data,
    stake: Math.round(parsed.data.stake * 100) / 100,
  });
  return ok(result);
});
