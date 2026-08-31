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

/**
 * Convert a wallet amount into a crypto-coin amount for display/payout
 * estimates. `cryptoRates` (settings) are KES per 1 coin.
 *
 * Rules:
 *   - wallet currency === coin            → 1:1 (the amount already IS the coin)
 *   - USD-pegged wallet (USD/USDT/USDC) on USD-pegged coins (USDT/USDC/USD)
 *                                        → 1:1 ($1 = 1 USDT)
 *   - KES wallet                          → amount ÷ KES-per-coin rate
 *   - any other wallet                    → amount ÷ (KES-per-coin ÷ KES-per-wallet)
 *                                          (converts through the currency table)
 *
 * Returns null when no usable rate exists — callers must refuse the action
 * rather than guess.
 */
export async function cryptoAmountFor(
  amount: number,
  walletCurrency: string,
  coin: string,
  cryptoRates: Record<string, number>,
): Promise<number | null> {
  const wc = walletCurrency.toUpperCase();
  const c = coin.toUpperCase();
  if (wc === c) return amount;
  const usdPegged = (cur: string) => cur === "USD" || cur === "USDT" || cur === "USDC";
  if (usdPegged(wc) && usdPegged(c)) return amount; // 1:1
  const kesPerCoin = cryptoRates[c];
  if (!kesPerCoin || kesPerCoin <= 0) return null;
  if (wc === "KES") return amount / kesPerCoin;
  const map = await currencyMap();
  const kesPerWallet = map[wc]?.rate;
  if (!kesPerWallet || kesPerWallet <= 0) return null;
  return amount / (kesPerCoin / kesPerWallet);
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
