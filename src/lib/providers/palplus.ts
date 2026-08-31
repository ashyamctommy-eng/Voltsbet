/**
 * M-Pesa via PalPluss gateway — STK Push deposits + B2C payouts.
 * Docs: https://docs.palpluss.com · OpenAPI: https://docs.palpluss.com/openapi.yaml
 *
 * Contract (verified against the live API + OpenAPI spec, 2026-08-31):
 *   Base   https://api.palpluss.com/v1      (production)
 *          https://sandbox.palpluss.com/v1  (test)
 *   Auth   HTTP Basic — the API key IS the credential. Send the key as the
 *          username with an EMPTY password: `Authorization: Basic <key:>`
 *          (base64 of "key:"). Keys start with pp_live_ / pp_test_ (observed
 *          2026-08-31; their docs say pk_* but the console issues pp_*).
 *          (console.palpluss.com → Settings → API Keys). There is NO token
 *          endpoint and no OAuth — every request authenticates directly.
 *   STK    POST /payments/stk
 *          { amount, phone, accountReference (≤12 chars), transactionDesc
 *            (≤13 chars), callbackUrl, channelId? }
 *          → data: { transactionId, providerCheckoutId, providerRequestId,
 *                    status: "PENDING", resultCode, resultDescription, ... }
 *   B2C    POST /b2c/payouts
 *          { amount (≥10), phone, reference, description?, channelId?,
 *            callbackUrl }
 *          → data: { transactionId, status: "PENDING", resultDescription, ... }
 *   Read   GET /wallets/service/balance  → data: { availableBalance, ... }
 *   Errors { success:false, error:{ message, code, details }, requestId }
 *          401 INVALID_API_KEY · 403 INSUFFICIENT_SCOPE · 403 KYC_NOT_VERIFIED
 *          402 INSUFFICIENT_SERVICE_BALANCE · 409 INSUFFICIENT_FUNDS
 *          400 NO_PAYMENT_CHANNELS / NO_DEFAULT_CHANNEL / INVALID_PHONE
 *          429 RATE_LIMIT_EXCEEDED (60 req/min/key)
 *   Webhooks PalPluss POSTs { event:"transaction.updated",
 *            event_type:"transaction.success|failed|cancelled|expired",
 *            transaction:{ id, type, status, amount, external_reference,
 *            mpesa_receipt, result_code, result_desc, ... } } to the
 *            callbackUrl. No signature header is documented — we authenticate
 *            callbacks by appending ?secret=<webhookSecret> to the callback
 *            URL at initiation (the gateway echoes the full URL). An optional
 *            x-palpluss-signature HMAC-SHA256 is verified when present.
 *
 * Credentials live in settings (Admin → M-Pesa (Palplus)):
 *   palplus.apiKey, palplus.channelId (optional — only needed when no default
 *   channel is set in the console), palplus.webhookSecret, palplus.env.
 */
import { createHmac } from "crypto";
import { getSettings } from "@/lib/settings";
import { ApiError } from "@/lib/api";
import { normalizeMpesaPhone } from "./mpesa";

function palplusBase(env: string): string {
  // Allow an explicit override for regional/gateway mirrors.
  if (process.env.PALPLUS_BASE_URL) return process.env.PALPLUS_BASE_URL;
  return env === "production" ? "https://api.palpluss.com/v1" : "https://sandbox.palpluss.com/v1";
}

async function palplusApiKey(): Promise<string> {
  const s = await getSettings();
  if (!s.palplusApiKey) {
    throw new ApiError(503, "Palpluss is not configured (API key missing).", "PALPLUS_UNCONFIGURED");
  }
  return s.palplusApiKey;
}

/** HTTP Basic auth — key as username, empty password (docs: `Basic <key:>`). */
function basicAuth(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

type PalplusEnvelope =
  | { success: true; data: Record<string, unknown>; requestId?: string }
  | {
      success: false;
      error?: { message?: string; code?: string; details?: Record<string, unknown> };
      requestId?: string;
    };

async function palplusRequest(
  path: string,
  init: { method?: string; body?: unknown },
  overrides?: { apiKey?: string; env?: string },
): Promise<Record<string, unknown>> {
  const s = await getSettings();
  const apiKey = overrides?.apiKey || (await palplusApiKey());
  if (!apiKey) {
    throw new ApiError(503, "Palpluss is not configured (API key missing).", "PALPLUS_UNCONFIGURED");
  }
  const env = overrides?.env || s.palplusEnv;
  const res = await fetch(`${palplusBase(env)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(apiKey),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as PalplusEnvelope;
  if (!res.ok || !data.success) {
    const err = (data as { error?: { message?: string; code?: string } }).error;
    const code = err?.code ?? `HTTP_${res.status}`;
    const message = err?.message ?? `Palpluss request failed (${res.status})`;
    // Map their codes onto our ApiError codes so callers can branch.
    const mapped: Record<string, string> = {
      INVALID_API_KEY: "PALPLUS_AUTH_FAILED",
      INSUFFICIENT_SERVICE_BALANCE: "PALPLUS_NO_FEES",
      KYC_NOT_VERIFIED: "PALPLUS_KYC_REQUIRED",
      NO_PAYMENT_CHANNELS: "PALPLUS_NO_CHANNEL",
      NO_DEFAULT_CHANNEL: "PALPLUS_NO_CHANNEL",
      CHANNEL_NOT_FOUND: "PALPLUS_NO_CHANNEL",
      INSUFFICIENT_FUNDS: "PALPLUS_NO_FUNDS",
      RATE_LIMIT_EXCEEDED: "PALPLUS_RATE_LIMIT",
    };
    throw new ApiError(502, `Palpluss: ${message}`, mapped[code] ?? "PALPLUS_ERROR");
  }
  return (data as { data: Record<string, unknown> }).data ?? {};
}

/** Append the webhook secret to a callback URL so callbacks authenticate. */
export function secureCallbackUrl(url: string, secret: string | null | undefined): string {
  if (!secret) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}secret=${encodeURIComponent(secret)}`;
}

export type PalplusStkResult = {
  transactionId: string;
  providerRequestId: string | null;
  providerCheckoutId: string | null;
  status: string;
  resultDescription: string | null;
  transactionFee: number;
};

/** Initiate an STK Push (deposit): the user gets a PIN prompt on their phone. */
export async function palplusStkPush(opts: {
  amount: number; // KES
  phone: string; // 07... / 254... / +254...
  accountReference: string; // ≤12 chars — shown on the customer's M-Pesa statement
  callbackUrl: string;
  transactionDesc?: string; // ≤13 chars — shown on the PIN prompt
  channelId?: string;
}): Promise<PalplusStkResult> {
  const s = await getSettings();
  const data = await palplusRequest("/payments/stk", {
    method: "POST",
    body: {
      amount: Math.round(opts.amount),
      phone: normalizeMpesaPhone(opts.phone),
      accountReference: opts.accountReference.slice(0, 12),
      transactionDesc: (opts.transactionDesc ?? "VoltBet dep").slice(0, 13),
      callbackUrl: secureCallbackUrl(opts.callbackUrl, s.palplusWebhookSecret),
      ...(opts.channelId || s.palplusChannelId ? { channelId: opts.channelId || s.palplusChannelId } : {}),
    },
  });
  return {
    transactionId: String(data.transactionId ?? ""),
    providerRequestId: data.providerRequestId ? String(data.providerRequestId) : null,
    providerCheckoutId: data.providerCheckoutId ? String(data.providerCheckoutId) : null,
    status: String(data.status ?? "PENDING"),
    resultDescription: data.resultDescription ? String(data.resultDescription) : null,
    transactionFee: Number(data.transactionFee ?? 0),
  };
}

export type PalplusB2cResult = {
  transactionId: string;
  status: string;
  resultDescription: string | null;
};

/** Admin-initiated B2C payout (explicit click only — never automatic). */
export async function palplusB2c(opts: {
  amount: number; // KES, ≥10
  phone: string;
  reference: string; // e.g. WD-2026-XXXX — echoed back as external_reference
  description?: string;
  callbackUrl: string;
  channelId?: string;
}): Promise<PalplusB2cResult> {
  const s = await getSettings();
  const data = await palplusRequest("/b2c/payouts", {
    method: "POST",
    body: {
      amount: Math.round(opts.amount),
      phone: normalizeMpesaPhone(opts.phone),
      reference: opts.reference,
      ...(opts.description ? { description: opts.description } : {}),
      callbackUrl: secureCallbackUrl(opts.callbackUrl, s.palplusWebhookSecret),
      ...(opts.channelId || s.palplusChannelId ? { channelId: opts.channelId || s.palplusChannelId } : {}),
    },
  });
  return {
    transactionId: String(data.transactionId ?? ""),
    status: String(data.status ?? "PENDING"),
    resultDescription: data.resultDescription ? String(data.resultDescription) : null,
  };
}

export type PalplusBalance = {
  availableBalance: number;
  ledgerBalance: number;
  currency: string;
};

/** Read-only service-wallet balance — used by the admin "Test connection" button. */
export async function palplusServiceBalance(overrides?: {
  apiKey?: string; // from the settings form (unsaved value) — falls back to saved key
  env?: string;
}): Promise<PalplusBalance> {
  const data = await palplusRequest("/wallets/service/balance", {}, overrides);
  return {
    availableBalance: Number(data.availableBalance ?? 0),
    ledgerBalance: Number(data.ledgerBalance ?? 0),
    currency: String(data.currency ?? "KES"),
  };
}

/**
 * Verify a Palpluss webhook callback. PalPluss signs nothing per its docs; we
 * authenticate callbacks with the ?secret= query param appended by
 * secureCallbackUrl() at initiation. An x-palpluss-signature HMAC-SHA256
 * header is also verified when present (belt-and-braces if the gateway adds it).
 */
export async function verifyPalplusWebhook(
  rawBody: string,
  signatureHeader: string | null,
  querySecret: string | null,
): Promise<boolean> {
  const s = await getSettings();
  if (!s.palplusWebhookSecret) return false;
  if (querySecret && querySecret === s.palplusWebhookSecret) return true;

  if (signatureHeader) {
    const expected = createHmac("sha256", s.palplusWebhookSecret).update(rawBody).digest("hex");
    const got = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
    // Constant-time compare
    if (got.length === expected.length) {
      let diff = 0;
      for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff === 0) return true;
    }
  }
  return false;
}
