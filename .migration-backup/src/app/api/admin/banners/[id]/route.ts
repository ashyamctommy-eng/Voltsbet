import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "banners");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ApiError(400, "Bad body.", "BAD_BODY");
  const data: Record<string, unknown> = {};
  for (const k of ["title", "description", "image", "ctaText", "ctaUrl"]) if (body[k] !== undefined) data[k] = body[k];
  if (body.active !== undefined) data.active = !!body.active;
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  const banner = await prisma.banner.update({ where: { id }, data });
  await auditLog({ admin, action: "UPDATE", entity: "BANNER", entityId: id });
  return ok({ banner });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "banners");
  const { id } = await ctx.params;
  await prisma.banner.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "BANNER", entityId: id });
  return ok({ message: "Deleted" });
});
