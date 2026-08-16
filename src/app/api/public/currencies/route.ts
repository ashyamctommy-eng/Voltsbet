import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Public dropdown data for account settings (no auth required). */
export const GET = handle(async () => {
  const [currencies, languages] = await Promise.all([
    prisma.currency.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.language.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return ok({
    currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
    languages: languages.map((l) => ({ code: l.code, name: l.name })),
  });
});
