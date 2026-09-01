import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { invalidateCurrencyCache } from "@/lib/currency";
import { z } from "zod";

const schema = z.object({
  code: z.string().min(3).max(5).transform((s) => s.toUpperCase()),
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().min(0).max(4).default(2),
  rate: z.number().positive(),
  active: z.boolean().optional().default(true),
});

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "currencies");
  const currencies = await prisma.currency.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ currencies });
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "currencies");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const exists = await prisma.currency.findUnique({ where: { code: parsed.data.code } });
  if (exists) throw new ApiError(409, "Currency already exists.", "EXISTS");

  const currency = await prisma.currency.create({ data: parsed.data });
  invalidateCurrencyCache();
  await auditLog({ admin, action: "CREATE", entity: "CURRENCY", entityId: parsed.data.code, newValue: parsed.data });
  return ok({ currency });
});

