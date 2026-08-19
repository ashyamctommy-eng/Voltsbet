import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2),
  avatar: z.string().optional().default(""),
  rating: z.number().min(1).max(5),
  text: z.string().min(5),
  status: z.string().optional().default("APPROVED"),
  sortOrder: z.number().optional().default(0),
});

export const GET = handle(async () => {
  await requireAdmin("testimonials");
  const testimonials = await prisma.testimonial.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ testimonials });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("testimonials");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const testimonial = await prisma.testimonial.create({ data: parsed.data });
  await auditLog({ admin, action: "CREATE", entity: "TESTIMONIAL", entityId: testimonial.id });
  return ok({ testimonial });
});


