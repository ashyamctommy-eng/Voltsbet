import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  icon: z.string().optional().default(""),
  sortOrder: z.number().optional().default(0),
  active: z.boolean().optional().default(true),
  isPopular: z.boolean().optional().default(false),
});

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "sports");
  const sports = await prisma.sport.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { games: true } } },
  });
  return ok({ sports });
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "sports");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const exists = await prisma.sport.findUnique({ where: { slug: parsed.data.slug } });
  if (exists) throw new ApiError(409, "A sport with this slug already exists.", "SLUG_TAKEN");

  const sport = await prisma.sport.create({ data: parsed.data });
  await auditLog({ admin, action: "CREATE", entity: "SPORT", entityId: sport.id, newValue: parsed.data });
  return ok({ sport });
});
