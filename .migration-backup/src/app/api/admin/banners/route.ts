import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
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

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "banners");
  const banners = await prisma.banner.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ banners });
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "banners");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const banner = await prisma.banner.create({ data: parsed.data });
  await auditLog({ admin, action: "CREATE", entity: "BANNER", entityId: banner.id });
  return ok({ banner });
});


