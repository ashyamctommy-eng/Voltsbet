import { prisma } from "./prisma";

let currencyCache: Record<string, { symbol: string; decimals: number; rate: number }> | null = null;

export async function currencyMap() {
  if (currencyCache) return currencyCache;
  const rows = await prisma.currency.findMany({ where: { active: true } });
  currencyCache = Object.fromEntries(
    rows.map((c) => [c.code, { symbol: c.symbol, decimals: c.decimals, rate: Number(c.rate) }])
  );
  return currencyCache;
}

export async function invalidateCurrencyCache() {
  currencyCache = null;
}

/** Convert `amount` (in currency `from`) to currency `to`. */
export async function convert(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount;
  const map = await currencyMap();
  const f = map[from];
  const t = map[to];
  if (!f || !t) return amount;
  // rate = base units per 1 unit of currency → value_in_base = amount * f.rate
  const inBase = amount * f.rate;
  return inBase / t.rate;
}

/** Format an amount (in currency `code`) for display. */
export async function formatMoney(amount: number | string, code: string, opts: { compact?: boolean } = {}) {
  const map = await currencyMap();
  const c = map[code] ?? { symbol: code, decimals: 2, rate: 1 };
  const n = Number(amount);
  const fixed = opts.compact ? 0 : c.decimals;
  return `${c.symbol} ${n.toLocaleString("en-US", {
    minimumFractionDigits: fixed,
    maximumFractionDigits: fixed,
  })}`;
}
