import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "promotions");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ApiError(400, "Bad body.", "BAD_BODY");
  const data: Record<string, unknown> = {};
  for (const k of ["title", "description", "image", "bonusType", "terms"]) if (body[k] !== undefined) data[k] = body[k] || null;
  if (body.active !== undefined) data.active = !!body.active;
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  if (body.bonusValue !== undefined) data.bonusValue = Number(body.bonusValue).toFixed(2);
  if (body.startAt !== undefined) data.startAt = body.startAt ? new Date(body.startAt) : null;
  if (body.endAt !== undefined) data.endAt = body.endAt ? new Date(body.endAt) : null;

  const promotion = await prisma.promotion.update({ where: { id }, data });
  await auditLog({ admin, action: "UPDATE", entity: "PROMOTION", entityId: id });
  return ok({ promotion });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "promotions");
  const { id } = await ctx.params;
  await prisma.promotion.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "PROMOTION", entityId: id });
  return ok({ message: "Deleted" });
});
