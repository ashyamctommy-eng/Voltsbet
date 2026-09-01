import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

/** Public dropdown data for account settings + the platform-wide default
 *  operating currency (admin-configured). No auth required. */
export const GET = handle(async () => {
  const [currencies, languages, settings] = await Promise.all([
    prisma.currency.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.language.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    getSettings(),
  ]);
  const defaultCode = settings.currencyDefault;
  const def = currencies.find((c) => c.code === defaultCode);
  return ok({
    currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals, rate: Number(c.rate) })),
    languages: languages.map((l) => ({ code: l.code, name: l.name })),
    defaultCode: def ? def.code : (currencies[0]?.code ?? "KES"),
  });
});
