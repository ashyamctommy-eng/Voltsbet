import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/admin/outcomes/[id] — edit odds, suspend/activate, rename.
 * Body: { odds?, status?, name?, label? }
 */
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("odds");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  const prev = await prisma.outcome.findUnique({ where: { id }, include: { market: true } });
  if (!prev) throw new ApiError(404, "Outcome not found.", "NOT_FOUND");
  if (prev.settled) throw new ApiError(409, "Settled outcomes cannot be edited. Reopen first.", "SETTLED");

  const data: Record<string, unknown> = {};
  if (body?.odds !== undefined) {
    const odds = Number(body.odds);
    if (!(odds > 0)) throw new ApiError(400, "Odds must be positive.", "BAD_ODDS");
    data.odds = odds.toFixed(2);
  }
  // Status is validated against the status-engine enum — an unvalidated
  // string like "SUSPENDDED" used to silently keep the outcome bettable.
  if (body?.status !== undefined) {
    if (!["ACTIVE", "SUSPENDED"].includes(body.status)) {
      throw new ApiError(400, `Invalid outcome status: ${body.status}.`, "BAD_STATUS");
    }
    data.status = body.status;
  }
  if (body?.name !== undefined) data.name = String(body.name);
  if (body?.label !== undefined) data.label = body.label === "" ? null : String(body.label);

  const outcome = await prisma.outcome.update({ where: { id }, data });

  if (body?.odds !== undefined) {
    await auditLog({
      admin, action: "ODDS_CHANGE", entity: "OUTCOME", entityId: id, gameId: prev.market.gameId,
      prevValue: { odds: Number(prev.odds) }, newValue: { odds: Number(outcome.odds) },
    });
  } else {
    await auditLog({ admin, action: "UPDATE", entity: "OUTCOME", entityId: id, gameId: prev.market.gameId, newValue: data });
  }
  return ok({ outcome });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("odds");
  const { id } = await ctx.params;
  const betCount = await prisma.betSelection.count({ where: { outcomeId: id } });
  if (betCount > 0) throw new ApiError(409, "Bets reference this outcome — suspend it instead.", "HAS_BETS");
  await prisma.outcome.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "OUTCOME", entityId: id });
  return ok({ message: "Deleted" });
});
