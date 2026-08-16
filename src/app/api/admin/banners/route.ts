import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  title: z.string().optional().default(""),
  description: z.string().optional().default(""),
  image: z.string().min(1),
  ctaText: z.string().optional().default(""),
  ctaUrl: z.string().optional().default(""),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().optional().default(0),
});

export const GET = handle(async () => {
  await requireAdmin("banners");
  const banners = await prisma.banner.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ banners });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("banners");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const banner = await prisma.banner.create({ data: parsed.data });
  await auditLog({ admin, action: "CREATE", entity: "BANNER", entityId: banner.id });
  return ok({ banner });
});

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("banners");
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
  await verifyCsrf(req);
  const admin = await requireAdmin("banners");
  const { id } = await ctx.params;
  await prisma.banner.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "BANNER", entityId: id });
  return ok({ message: "Deleted" });
});
