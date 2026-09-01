import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { invalidateCurrencyCache } from "@/lib/currency";

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const admin = await sharedAdminGuard(req, "currencies");
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
