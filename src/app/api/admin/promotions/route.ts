import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
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

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "promotions");
  const promotions = await prisma.promotion.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ promotions });
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "promotions");
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


