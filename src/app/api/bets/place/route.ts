import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { placeBet } from "@/lib/bet-engine";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  selections: z
    .array(z.object({ outcomeId: z.string().min(1), oddsAtPlacement: z.number() }))
    .min(1),
  stake: z.number(),
  type: z.enum(["SINGLE", "MULTIPLE"]),
  acceptOddsChange: z.boolean().optional().default(false),
  // Client-generated key: the same key replays the original bet, so a double
  // click or a network retry can never place the same bet twice.
  idempotencyKey: z.string().min(1).max(100).optional(),
});

// Per-user placement ceiling — stops stake-probing bursts and runaway retry
// loops without touching legitimate use (20/min is far above human pace).
const BET_RATE_MAX = 20;
const BET_RATE_WINDOW_MS = 60_000;

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const rl = rateLimit(`bet:${user.id}`, BET_RATE_MAX, BET_RATE_WINDOW_MS);
  if (!rl.ok) {
    throw new ApiError(429, "You're placing bets too quickly — wait a moment and try again.", "RATE_LIMITED");
  }
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
