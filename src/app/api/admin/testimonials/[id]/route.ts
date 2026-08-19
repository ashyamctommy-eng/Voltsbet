import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("testimonials");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ApiError(400, "Bad body.", "BAD_BODY");
  const data: Record<string, unknown> = {};
  for (const k of ["name", "avatar", "text", "status"]) if (body[k] !== undefined) data[k] = body[k];
  if (body.rating !== undefined) data.rating = Number(body.rating);
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  const testimonial = await prisma.testimonial.update({ where: { id }, data });
  await auditLog({ admin, action: "UPDATE", entity: "TESTIMONIAL", entityId: id });
  return ok({ testimonial });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("testimonials");
  const { id } = await ctx.params;
  await prisma.testimonial.delete({ where: { id } });
  await auditLog({ admin, action: "DELETE", entity: "TESTIMONIAL", entityId: id });
  return ok({ message: "Deleted" });
});
