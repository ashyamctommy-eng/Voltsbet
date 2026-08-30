import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** PATCH /api/admin/markets/[id] — rename, open/suspend/close/settle-status. */
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "games");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const { name, status } = body ?? {};
  if (name === undefined && status === undefined) throw new ApiError(400, "Nothing to update.", "BAD_BODY");

  const prev = await prisma.market.findUnique({ where: { id } });
  if (!prev) throw new ApiError(404, "Market not found.", "NOT_FOUND");

  // Status validated against the status-engine enum — a typo must not
  // silently defeat the market-status gate in the betting engine.
  if (status !== undefined && !["OPEN", "SUSPENDED", "CLOSED", "SETTLED"].includes(status)) {
    throw new ApiError(400, `Invalid market status: ${status}.`, "BAD_STATUS");
  }

  const market = await prisma.market.update({
    where: { id },
    data: { ...(name !== undefined ? { name } : {}), ...(status !== undefined ? { status } : {}) },
  });
  await auditLog({
    admin, action: "UPDATE", entity: "MARKET", entityId: id, gameId: prev.gameId,
    prevValue: { status: prev.status }, newValue: { status: market.status },
  });
  return ok({ market });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "games");
  const { id } = await ctx.params;
  const betCount = await prisma.betSelection.count({ where: { marketId: id } });
  if (betCount > 0) throw new ApiError(409, "Bets reference this market — suspend it instead.", "HAS_BETS");
  const market = await prisma.market.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "MARKET", entityId: id, gameId: market.gameId });
  return ok({ message: "Deleted" });
});
