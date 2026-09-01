import { getSettings } from "@/lib/settings";
import { ApiError } from "@/lib/api";

/**
 * M-Pesa Daraja (Safaricom) integration — STK Push deposits + B2C payouts.
 * Docs: https://developer.safaricom.co.ke
 *
 * Setup (see docs/DEPLOYMENT-RAILWAY.md for the full walkthrough):
 *   1. developer.safaricom.co.ke → create app → get Consumer Key/Secret
 *   2. Sandbox: use the test Paybill (174379) + passkey from the sandbox portal
 *   3. B2C: generate the SecurityCredential from your Initiator password
 *      (script: pnpm tsx scripts/gen-mpesa-credential.ts) and put it in settings
 *
 * Phone numbers are normalized to 254XXXXXXXXX.
 */

function mpesaBase(env: string) {
  return env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function mpesaToken(): Promise<string> {
  const s = await getSettings();
  if (!s.mpesaConsumerKey || !s.mpesaConsumerSecret) {
    throw new ApiError(503, "M-Pesa is not configured (consumer key/secret).", "MPESA_UNCONFIGURED");
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const cred = Buffer.from(`${s.mpesaConsumerKey}:${s.mpesaConsumerSecret}`).toString("base64");
  const res = await fetch(`${mpesaBase(s.mpesaEnv)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${cred}` },
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) {
    throw new ApiError(502, "M-Pesa auth failed — check consumer key/secret.", "MPESA_AUTH_FAILED");
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

export function normalizeMpesaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  throw new ApiError(400, "Enter a valid Kenyan phone number, e.g. 0712 345 678.", "BAD_PHONE");
}

function timestamp(): string {
  // Safaricom expects Nairobi time (UTC+3), format YYYYMMDDHHmmss
  const now = new Date(Date.now() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

function stkPassword(shortcode: string, passkey: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp()}`).toString("base64");
}

export type StkPushResult = {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
};

/** Initiate an STK Push: the user gets a PIN prompt on their phone. */
export async function mpesaStkPush(opts: { amount: number; phone: string; accountReference: string; callbackUrl: string }) {
  const s = await getSettings();
  if (!s.mpesaShortcode || !s.mpesaPasskey) {
    throw new ApiError(503, "M-Pesa is not configured (shortcode/passkey).", "MPESA_UNCONFIGURED");
  }
  const phone = normalizeMpesaPhone(opts.phone);
  const token = await mpesaToken();

  const res = await fetch(`${mpesaBase(s.mpesaEnv)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: s.mpesaShortcode,
      Password: stkPassword(s.mpesaShortcode, s.mpesaPasskey),
      Timestamp: timestamp(),
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(opts.amount),
      PartyA: phone,
      PartyB: s.mpesaShortcode,
      PhoneNumber: phone,
      CallBackURL: opts.callbackUrl,
      AccountReference: opts.accountReference.slice(0, 12),
      TransactionDesc: "UNIBET360 deposit",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<StkPushResult>;
  if (!res.ok || (data.ResponseCode && data.ResponseCode !== "0")) {
    throw new ApiError(502, `M-Pesa STK push failed: ${data.ResponseDescription ?? res.status}`, "MPESA_STK_FAILED");
  }
  if (data.ResponseCode !== "0") {
    throw new ApiError(502, `M-Pesa rejected the request: ${data.ResponseDescription ?? "unknown"}`, "MPESA_STK_FAILED");
  }
  return data as StkPushResult;
}

/** Query the status of an STK push (ResultCode 0 = paid). */
export async function mpesaStkQuery(checkoutRequestId: string) {
  const s = await getSettings();
  if (!s.mpesaShortcode || !s.mpesaPasskey) {
    throw new ApiError(503, "M-Pesa is not configured.", "MPESA_UNCONFIGURED");
  }
  const token = await mpesaToken();
  const res = await fetch(`${mpesaBase(s.mpesaEnv)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: s.mpesaShortcode,
      Password: stkPassword(s.mpesaShortcode, s.mpesaPasskey),
      Timestamp: timestamp(),
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { ResultCode?: string; ResultDesc?: string };
  return { ok: data.ResultCode === "0", resultCode: data.ResultCode, desc: data.ResultDesc };
}

export type B2cResult = {
  OriginatorConversationID: string;
  ConversationID: string;
  ResponseCode: string;
  ResponseDescription: string;
};

/** Send money from your Paybill to a customer's M-Pesa number (B2C). */
export async function mpesaB2c(opts: {
  amount: number;
  phone: string;
  remarks: string;
  resultUrl: string;
  queueTimeOutUrl: string;
  commandId?: string; // SalaryPayment | BusinessPayment | PromotionPayment
}) {
  const s = await getSettings();
  if (!s.mpesaShortcode || !s.mpesaInitiatorName || !s.mpesaSecurityCredential) {
    throw new ApiError(
      503,
      "M-Pesa B2C is not configured (initiator name + security credential). Generate the credential with: pnpm tsx scripts/gen-mpesa-credential.ts",
      "MPESA_B2C_UNCONFIGURED"
    );
  }
  const phone = normalizeMpesaPhone(opts.phone);
  const token = await mpesaToken();

  const res = await fetch(`${mpesaBase(s.mpesaEnv)}/mpesa/b2c/v1/paymentrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      InitiatorName: s.mpesaInitiatorName,
      SecurityCredential: s.mpesaSecurityCredential,
      CommandID: opts.commandId ?? "BusinessPayment",
      Amount: Math.round(opts.amount),
      PartyA: s.mpesaShortcode,
      PartyB: phone,
      Remarks: opts.remarks.slice(0, 100),
      QueueTimeOutURL: opts.queueTimeOutUrl,
      ResultURL: opts.resultUrl,
      Occasion: "UNIBET360 payout",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<B2cResult>;
  if (!res.ok || (data.ResponseCode && data.ResponseCode !== "0")) {
    throw new ApiError(502, `M-Pesa B2C failed: ${data.ResponseDescription ?? res.status}`, "MPESA_B2C_FAILED");
  }
  if (data.ResponseCode !== "0") {
    throw new ApiError(502, `M-Pesa rejected the payout: ${data.ResponseDescription ?? "unknown"}`, "MPESA_B2C_FAILED");
  }
  return data as B2cResult;
}

/** Public base URL for callbacks — from settings (app.url) or APP_URL env. */
export function publicBaseUrl(s: { appUrl: string }) {
  return (s.appUrl || process.env.APP_URL || "").replace(/\/$/, "");
}
