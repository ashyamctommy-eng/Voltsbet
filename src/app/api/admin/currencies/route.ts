import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
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

export const GET = handle(async () => {
  await requireAdmin("currencies");
  const currencies = await prisma.currency.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ currencies });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("currencies");
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

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("currencies");
  const { code } = await ctx.params;
  const body = await req.json().catch(() => null);
  const prev = await prisma.currency.findUnique({ where: { code } });
  if (!prev) throw new ApiError(404, "Currency not found.", "NOT_FOUND");

  const data: Record<string, unknown> = {};
  if (body?.name !== undefined) data.name = String(body.name);
  if (body?.symbol !== undefined) data.symbol = String(body.symbol);
  if (body?.decimals !== undefined) data.decimals = Number(body.decimals);
  if (body?.rate !== undefined) data.rate = Number(body.rate).toFixed(6);
  if (body?.active !== undefined) data.active = !!body.active;
  if (body?.isDefault) {
    await prisma.currency.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    data.isDefault = true;
  }

  const currency = await prisma.currency.update({ where: { code }, data });
  invalidateCurrencyCache();
  await auditLog({ admin, action: "UPDATE", entity: "CURRENCY", entityId: code, prevValue: prev, newValue: currency });
  return ok({ currency });
});
