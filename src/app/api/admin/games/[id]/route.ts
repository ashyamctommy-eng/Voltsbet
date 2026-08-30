import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const editSchema = z.object({
  competitionId: z.string().optional(),
  homeName: z.string().min(1).optional(),
  awayName: z.string().min(1).optional(),
  startAt: z.string().optional(),
  featured: z.boolean().optional(),
  status: z.enum(["SCHEDULED", "LIVE", "HALF_TIME", "FINISHED", "CANCELLED", "POSTPONED"]).optional(),
  homeScore: z.number().optional(),
  awayScore: z.number().optional(),
  halfHomeScore: z.number().nullable().optional(),
  halfAwayScore: z.number().nullable().optional(),
  period: z.string().nullable().optional(),
  clock: z.string().nullable().optional(),
  live: z.boolean().optional(),
});

/** GET /api/admin/games/[id] — full game with markets/outcomes for the control room. */
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin("games");
  const { id } = await ctx.params;
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      sport: true,
      markets: {
        include: {
          outcomes: {
            include: { _count: { select: { selections: true } } },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!game) throw new ApiError(404, "Game not found.", "NOT_FOUND");
  return ok({ game });
});

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("games");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;

  const prev = await prisma.game.findUnique({ where: { id }, include: { sport: true } });
  if (!prev) throw new ApiError(404, "Game not found.", "NOT_FOUND");

  const data: Record<string, unknown> = { ...d };
  if (d.startAt) data.startAt = new Date(d.startAt);
  if (d.status) {
    // Keep the `live` flag in sync for list filtering
    data.live = ["LIVE", "HALF_TIME"].includes(d.status);
  }

  const game = await prisma.game.update({ where: { id }, data });
  await auditLog({
    admin,
    action: d.status && d.status !== prev.status ? "LIVE_CONTROL" : "UPDATE",
    entity: "GAME",
    entityId: id,
    gameId: id,
    prevValue: { status: prev.status, homeScore: prev.homeScore, awayScore: prev.awayScore, clock: prev.clock, period: prev.period },
    newValue: { status: game.status, homeScore: game.homeScore, awayScore: game.awayScore, clock: game.clock, period: game.period },
  });
  return ok({ game });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("games");
  const { id } = await ctx.params;
  const betCount = await prisma.betSelection.count({ where: { gameId: id } });
  if (betCount > 0) {
    throw new ApiError(409, "Bets exist on this game — suspend/close its markets instead of deleting.", "HAS_BETS");
  }
  await prisma.game.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "GAME", entityId: id });
  return ok({ message: "Deleted" });
});
