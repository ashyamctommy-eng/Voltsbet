import { createHmac } from "crypto";
import { getSettings } from "@/lib/settings";
import { ApiError } from "@/lib/api";

/**
 * NOWPayments integration (deposits + payouts).
 * Docs: https://documenter.getpostman.com/view/7907941/S1a32nMv
 *
 * Setup: create an account → API keys in the dashboard:
 *   - API key      → crypto.apiKey        (create payments, check status)
 *   - IPN secret   → crypto.ipnSecret     (webhook HMAC verification)
 *   - Payout key   → crypto.payoutApiKey  (send withdrawals from your balance)
 *
 * NOWPayments is custodial by default (2026): received crypto sits in your
 * NOWPayments balance until you withdraw it — no hot wallet needed to start.
 */

const API = "https://api.nowpayments.io/v1";

/**
 * Coins with NO bare code on NOWPayments — a network suffix is mandatory.
 * Verified live 2026-09-02: /v1/currencies lists `usdttrc20`/`bnbbsc` but no
 * bare `usdt`/`bnb`. Sending a bare code for these fails or resolves
 * unpredictably, so a default token is enforced below.
 */
export const NP_REQUIRED_NETWORK: Record<string, string> = { USDT: "TRC20", BNB: "BSC" };

/**
 * Map a coin + admin network token → the NOWPayments pay_currency code.
 * - USDT + TRC20 → "usdttrc20", BNB + BSC → "bnbbsc"
 * - Token empty and the coin has a bare code → coin only ("btc", "eth", "usdc")
 * - Token empty but the coin REQUIRES one → NP_REQUIRED_NETWORK default
 * Returns the resolved code plus the effective network token (null = bare/auto).
 */
export function npPayCurrency(
  coin: string,
  networkToken?: string | null
): { code: string; network: string | null } {
  const c = coin.trim().toUpperCase();
  let token = (networkToken ?? "").trim().toUpperCase();
  if (!token) token = NP_REQUIRED_NETWORK[c] || "";
  // A token equal to the coin itself (e.g. {"BTC":"BTC"}) means "native chain"
  // — collapse to the bare code instead of emitting "btcbtc". Same for tokens
  // that only re-state the coin's own chain (ETH is ERC20; bare "eth" is it).
  if (token === c) token = "";
  return { code: token ? `${c.toLowerCase()}${token.toLowerCase()}` : c.toLowerCase(), network: token || null };
}

async function npFetch(path: string, opts: { method?: string; key: string; body?: unknown } = { method: "GET", key: "" }) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-api-key": opts.key,
      "content-type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(502, `NOWPayments error ${res.status}: ${text.slice(0, 200)}`, "PROVIDER_ERROR");
  }
  return JSON.parse(text || "{}");
}

export type NpPayment = {
  payment_id: number;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  payment_status: string; // waiting | confirming | confirmed | sending | partially_paid | finished | failed | refunded | expired
  price_amount: number;
  price_currency: string;
  order_id?: string;
  created_at?: string;
  expires_at?: string;
};

/** Create a per-order payment. Returns the address the user pays to. */
export async function npCreatePayment(opts: {
  priceAmount: number;      // amount in KES (or base currency)
  priceCurrency: string;    // "KES"
  payCurrency: string;      // "USDT", "BTC" …
  orderId: string;          // our deposit id
  ipnCallbackUrl: string;
}) {
  const settings = await getSettings();
  if (!settings.cryptoApiKey) throw new ApiError(503, "Crypto provider not configured.", "PROVIDER_UNCONFIGURED");

  const data = await npFetch("/payment", {
    method: "POST",
    key: settings.cryptoApiKey,
    body: {
      price_amount: opts.priceAmount,
      price_currency: opts.priceCurrency,
      pay_currency: opts.payCurrency,
      order_id: opts.orderId,
      ipn_callback_url: opts.ipnCallbackUrl,
      is_fixed_rate: false,
    },
  });
  return data as NpPayment;
}

export async function npGetPaymentStatus(paymentId: number | string) {
  const settings = await getSettings();
  if (!settings.cryptoApiKey) throw new ApiError(503, "Crypto provider not configured.", "PROVIDER_UNCONFIGURED");
  return (await npFetch(`/payment/${paymentId}`, { key: settings.cryptoApiKey })) as NpPayment;
}

/** Verify an IPN webhook: HMAC-SHA512 of the raw body with the IPN secret. */
export async function npVerifyIpn(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const settings = await getSettings();
  const secret = settings.cryptoIpnSecret;
  if (!secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  // constant-time-ish compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export type NpPayout = {
  id: number;
  withdrawals: { id: number; address: string; currency: string; amount: number; status: string }[];
};

/** Send crypto from your NOWPayments balance to a customer address. */
export async function npCreatePayout(opts: { address: string; currency: string; amount: number }) {
  const settings = await getSettings();
  if (!settings.cryptoPayoutApiKey) {
    throw new ApiError(503, "Crypto payout not configured (crypto.payoutApiKey).", "PAYOUT_UNCONFIGURED");
  }
  return (await npFetch("/payout", {
    method: "POST",
    key: settings.cryptoPayoutApiKey,
    body: {
      withdrawals: [{ address: opts.address, currency: opts.currency, amount: opts.amount }],
    },
  })) as NpPayout;
}
