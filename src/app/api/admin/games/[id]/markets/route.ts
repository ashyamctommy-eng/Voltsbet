import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/**
 * POST /api/admin/games/[id]/markets — create a market with outcomes.
 */
const outcomeSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional().default(""),
  odds: z.number().positive(),
  status: z.string().optional().default("ACTIVE"),
});

const schema = z.object({
  name: z.string().min(1),
  key: z.string().optional().default("CUSTOM"),
  status: z.string().optional().default("OPEN"),
  settlementMethod: z.string().optional().default(""),
  outcomes: z.array(outcomeSchema).optional().default([]),
});

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "games");
  const { id } = await ctx.params;
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) throw new ApiError(404, "Game not found.", "NOT_FOUND");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;
  if (!d.outcomes.length) throw new ApiError(400, "Add at least one outcome.", "NO_OUTCOMES");

  const market = await prisma.market.create({
    data: {
      gameId: id,
      name: d.name,
      key: d.key,
      status: d.status,
      settlementMethod: d.settlementMethod || null,
      outcomes: {
        create: d.outcomes.map((o, i) => ({
          name: o.name,
          label: o.label || null,
          odds: o.odds.toFixed(2),
          status: o.status,
          sortOrder: i,
        })),
      },
    },
    include: { outcomes: true },
  });

  await auditLog({ admin, action: "CREATE", entity: "MARKET", entityId: market.id, gameId: id, newValue: { name: market.name, outcomes: market.outcomes.length } });
  return ok({ market });
});
