/**
 * M-Pesa via Palplus gateway — STK Push deposits + B2C payouts.
 * Docs: https://palplus.africa (Palplus Technologies API).
 *
 * Contract (verify against the Palplus merchant dashboard):
 *   Auth   POST {base}/api/v1/authentication/request   { apiKey } → { accessToken, expiresIn }
 *   STK    POST {base}/api/v1/stkpush/request          Bearer token,
 *          { merchantId, accountReference, amount, phoneNumber,
 *            callbackUrl, transactionDesc }
 *            → { merchantRequestId, checkoutRequestId, responseCode, ... }
 *   B2C    POST {base}/api/v1/b2c/request              Bearer token,
 *          { merchantId, phoneNumber, amount, reference, callbackUrl,
 *            transactionDesc }
 *            → { conversationId, ... }
 *   Webhook: Palplus POSTs the payment result to the callbackUrl. The body
 *   is signed with HMAC-SHA256(webhookSecret, rawBody) in a header
 *   (x-palplus-signature) — verifyPalplusWebhook() also accepts a ?secret=
 *   query param as a belt-and-braces fallback.
 *
 * Credentials live in settings (Admin → M-Pesa): palplus.apiKey,
 * palplus.merchantId, palplus.webhookSecret, palplus.env.
 */
import { createHmac } from "crypto";
import { getSettings } from "@/lib/settings";
import { ApiError } from "@/lib/api";
import { normalizeMpesaPhone } from "./mpesa";

function palplusBase(env: string): string {
  // Allow an explicit override for regional/gateway mirrors.
  if (process.env.PALPLUS_BASE_URL) return process.env.PALPLUS_BASE_URL;
  return env === "production" ? "https://api.palplus.africa" : "https://sandbox.palplus.africa";
}

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function palplusToken(): Promise<string> {
  const s = await getSettings();
  if (!s.palplusApiKey) {
    throw new ApiError(503, "Palplus is not configured (API key missing).", "PALPLUS_UNCONFIGURED");
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const res = await fetch(`${palplusBase(s.palplusEnv)}/api/v1/authentication/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: s.palplusApiKey }),
  });
  const data = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number };
  if (!res.ok || !data.accessToken) {
    throw new ApiError(502, "Palplus auth failed — check the API key.", "PALPLUS_AUTH_FAILED");
  }
  tokenCache = { token: data.accessToken, expiresAt: Date.now() + (data.expiresIn ?? 3600) * 1000 };
  return tokenCache.token;
}

export type PalplusStkResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
};

/** Initiate an STK Push (deposit): the user gets a PIN prompt on their phone. */
export async function palplusStkPush(opts: {
  amount: number; // KES
  phone: string; // 254XXXXXXXXX
  accountReference: string;
  callbackUrl: string;
  transactionDesc?: string;
}): Promise<PalplusStkResult> {
  const s = await getSettings();
  if (!s.palplusMerchantId) {
    throw new ApiError(503, "Palplus is not configured (merchant ID missing).", "PALPLUS_UNCONFIGURED");
  }
  const token = await palplusToken();
  const res = await fetch(`${palplusBase(s.palplusEnv)}/api/v1/stkpush/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      merchantId: s.palplusMerchantId,
      accountReference: opts.accountReference,
      amount: Math.round(opts.amount),
      phoneNumber: normalizeMpesaPhone(opts.phone),
      callbackUrl: opts.callbackUrl,
      transactionDesc: opts.transactionDesc ?? "VoltBet deposit",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<PalplusStkResult> & { error?: string };
  if (!res.ok) {
    throw new ApiError(502, `Palplus STK push failed: ${data.error ?? data.responseDescription ?? res.status}`, "PALPLUS_STK_FAILED");
  }
  if (!data.checkoutRequestId && !data.merchantRequestId) {
    throw new ApiError(502, "Palplus STK push returned no checkout reference.", "PALPLUS_STK_FAILED");
  }
  return {
    merchantRequestId: data.merchantRequestId ?? "",
    checkoutRequestId: data.checkoutRequestId ?? "",
    responseCode: data.responseCode ?? "0",
    responseDescription: data.responseDescription ?? "Success",
  };
}

/** Admin-initiated B2C payout (explicit click only — never automatic). */
export async function palplusB2c(opts: {
  amount: number; // KES
  phone: string; // 254XXXXXXXXX
  reference: string; // e.g. WD-2026-XXXX
  callbackUrl: string;
  transactionDesc?: string;
}): Promise<{ conversationId: string | null; receipt: string | null }> {
  const s = await getSettings();
  if (!s.palplusMerchantId) {
    throw new ApiError(503, "Palplus is not configured (merchant ID missing).", "PALPLUS_UNCONFIGURED");
  }
  const token = await palplusToken();
  const res = await fetch(`${palplusBase(s.palplusEnv)}/api/v1/b2c/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      merchantId: s.palplusMerchantId,
      phoneNumber: normalizeMpesaPhone(opts.phone),
      amount: Math.round(opts.amount),
      reference: opts.reference,
      callbackUrl: opts.callbackUrl,
      transactionDesc: opts.transactionDesc ?? `VoltBet payout ${opts.reference}`,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(502, `Palplus B2C failed: ${String(data.error ?? data.message ?? res.status)}`, "PALPLUS_B2C_FAILED");
  }
  return {
    conversationId: data.conversationId ? String(data.conversationId) : null,
    receipt: data.receipt ? String(data.receipt) : null,
  };
}

/**
 * Verify a Palplus webhook callback. Palplus signs the raw body with
 * HMAC-SHA256(webhookSecret) in a signature header; a ?secret= query param
 * is accepted as a fallback for gateways that cannot set headers.
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

