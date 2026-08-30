import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2).optional(),
  icon: z.string().optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional(),
  isPopular: z.boolean().optional(),
});

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "sports");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const prev = await prisma.sport.findUnique({ where: { id } });
  if (!prev) throw new ApiError(404, "Sport not found.", "NOT_FOUND");

  const sport = await prisma.sport.update({ where: { id }, data: parsed.data });
  await auditLog({ admin, action: "UPDATE", entity: "SPORT", entityId: id, prevValue: prev, newValue: sport });
  return ok({ sport });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "sports");
  const { id } = await ctx.params;
  const gameCount = await prisma.game.count({ where: { sportId: id } });
  if (gameCount > 0) {
    throw new ApiError(409, "This sport has games. Disable it instead of deleting.", "HAS_GAMES");
  }
  await prisma.sport.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "SPORT", entityId: id });
  return ok({ message: "Deleted" });
});
