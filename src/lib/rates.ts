/**
 * Automated market-rate sync — replaces manual admin rate entry.
 *
 * Two free, keyless sources (each independently resilient):
 *   1. FX (fiat):  open.er-api.com/v6/latest/KES — daily ECB/central-bank
 *      rates, base KES → Currency.rate (KES per 1 unit) = 1 / rates[code].
 *   2. Crypto:     CoinGecko simple/price in USD → settings.cryptoRates
 *      (KES per 1 coin) = USD price × KES-per-USD (derived from the FX feed).
 *
 * A failure in one source never blocks the other; currencies the feed has no
 * data for keep their existing rates. Admins can still edit rates manually —
 * the next sync overwrites them (documented in the admin UI).
 */
import { prisma } from "./prisma";
import { setSetting, invalidateSettingsCache } from "./settings";
import { invalidateCurrencyCache } from "./currency";

const FX_URL = "https://open.er-api.com/v6/latest/KES";
const CG_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,usd-coin,binancecoin,tron,litecoin,solana,ripple,dogecoin,the-open-network&vs_currencies=usd";

/** CoinGecko id per settings.cryptoRates coin key. */
const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  TRX: "tron",
  LTC: "litecoin",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  TON: "the-open-network",
};

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

export type RatesSyncResult = {
  fxUpdated: number;
  fxSource: string;
  cryptoRates: Record<string, number> | null;
  cryptoSource: string | null;
  at: string;
};

export async function syncMarketRates(): Promise<RatesSyncResult> {
  const at = new Date().toISOString();
  let fxUpdated = 0;
  let kesPerUsd = 0;

  // ── 1) Fiat exchange rates (base KES) ───────────────────────────────
  const fxRates = await fetch(FX_URL, { headers: { "user-agent": "UNIBET360/1.0" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`er-api HTTP ${r.status}`))))
    .then((j) => (j?.result === "success" && j.rates ? (j.rates as Record<string, number>) : null))
    .catch((e) => {
      console.error("[rates] FX fetch failed:", e instanceof Error ? e.message : e);
      return null;
    });

  if (fxRates) {
    // er-api rates are "units of X per 1 KES" (base=KES) → Currency.rate
    // (KES per 1 unit of X) = 1 / rates[X]; KES-per-USD for crypto = 1 / rates.USD.
    const usdPerKes = Number(fxRates["USD"]);
    kesPerUsd = Number.isFinite(usdPerKes) && usdPerKes > 0 ? 1 / usdPerKes : 0;
    const active = await prisma.currency.findMany({ where: { active: true } });
    for (const c of active) {
      if (c.code === "KES") continue; // base currency — rate stays 1
      const perKes = Number(fxRates[c.code]);
      if (!Number.isFinite(perKes) || perKes <= 0) continue; // not listed → keep current
      const rate = round(1 / perKes);
      if (Math.abs(Number(c.rate) - rate) > 1e-9) {
        await prisma.currency.update({ where: { code: c.code }, data: { rate: rate.toFixed(6) } });
        fxUpdated++;
      }
    }
    invalidateCurrencyCache();
  }

  // ── 2) Crypto prices (USD → KES via the FX feed) ────────────────────
  let cryptoRates: Record<string, number> | null = null;
  if (Number.isFinite(kesPerUsd) && kesPerUsd > 0) {
    const prices = await fetch(CG_URL, { headers: { "user-agent": "UNIBET360/1.0" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`coingecko HTTP ${r.status}`))))
      .catch((e) => {
        console.error("[rates] crypto fetch failed:", e instanceof Error ? e.message : e);
        return null;
      });
    if (prices) {
      const next: Record<string, number> = {};
      for (const [coin, id] of Object.entries(COIN_IDS)) {
        const usd = Number(prices?.[id]?.usd);
        if (Number.isFinite(usd) && usd > 0) next[coin] = round(usd * kesPerUsd, 2);
      }
      if (Object.keys(next).length) {
        cryptoRates = next;
        await setSetting("crypto.rates", JSON.stringify(cryptoRates));
        invalidateSettingsCache();
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "RATES_SYNC",
      entity: "SYSTEM",
      newValue: JSON.stringify({
        fxUpdated,
        fxRates: fxRates ? Object.keys(fxRates).length : 0,
        cryptoRates,
        at,
      }),
    },
  });

  return { fxUpdated, fxSource: fxRates ? FX_URL : "", cryptoRates, cryptoSource: cryptoRates ? CG_URL : null, at };
}
