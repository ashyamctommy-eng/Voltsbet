import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { quoteCashOut, executeCashOut } from "@/lib/cashout";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Cash-out API:
 *   GET  /api/account/bets/[id]/cashout → live quote (read-only, no money moves)
 *   POST /api/account/bets/[id]/cashout → execute full cash-out (atomic)
 */
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const bet = await prisma.bet.findFirst({
    where: { id, userId: user.id },
    include: { selections: { select: { outcomeId: true, settled: true, result: true } } },
  });
  if (!bet) throw new ApiError(404, "Bet not found.", "NOT_FOUND");
  const quote = await quoteCashOut(bet);
  return ok({ ...quote, betId: id });
});

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const rl = rateLimit(`cashout:${user.id}`, 10, 60_000);
  if (!rl.ok) {
    throw new ApiError(429, "You're doing that too often — wait a moment and try again.", "RATE_LIMITED");
  }
  const { id } = await ctx.params;
  const result = await executeCashOut(user.id, id);
  return ok(result);
});
