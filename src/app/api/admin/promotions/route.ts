import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(2),
  description: z.string().optional().default(""),
  image: z.string().optional().default(""),
  bonusType: z.string().optional().default(""),
  bonusValue: z.number().optional().default(0),
  terms: z.string().optional().default(""),
  active: z.boolean().optional().default(true),
  startAt: z.string().optional().default(""),
  endAt: z.string().optional().default(""),
  sortOrder: z.number().optional().default(0),
});

export const GET = handle(async () => {
  await requireAdmin("promotions");
  const promotions = await prisma.promotion.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ promotions });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("promotions");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;
  const promotion = await prisma.promotion.create({
    data: {
      title: d.title, description: d.description || null, image: d.image || null,
      bonusType: d.bonusType || null, bonusValue: d.bonusValue ? d.bonusValue.toFixed(2) : null,
      terms: d.terms || null, active: d.active, sortOrder: d.sortOrder,
      startAt: d.startAt ? new Date(d.startAt) : null, endAt: d.endAt ? new Date(d.endAt) : null,
    },
  });
  await auditLog({ admin, action: "CREATE", entity: "PROMOTION", entityId: promotion.id });
  return ok({ promotion });
});

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("promotions");
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
  await verifyCsrf(req);
  const admin = await requireAdmin("promotions");
  const { id } = await ctx.params;
  await prisma.promotion.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "PROMOTION", entityId: id });
  return ok({ message: "Deleted" });
});
