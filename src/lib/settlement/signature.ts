/**
 * Webhook authentication for the external settlement worker.
 *
 * WHY HMAC AND NOT A STATIC SECRET HEADER
 * A static `X-Secret: <value>` header only proves "whoever sent this saw the
 * secret". It does not bind the secret to the body, so:
 *   - a captured request can be replayed verbatim, for ever;
 *   - anyone who reads the header (a proxy log, a misconfigured middlebox, a
 *     screenshot in a support ticket) can forge any payload;
 *   - a bit-flip in transit is undetectable.
 * HMAC-SHA256 over `${timestamp}.${rawBody}` fixes all three: the signature is
 * bound to the exact bytes AND to the time they were sent, so a replay outside
 * the window fails, and any tampering with the body fails.
 *
 * The body must be the RAW bytes (`await req.text()`), never a re-serialized
 * object — JSON key order/whitespace would change the digest.
 *
 * Timing: both the timestamp check and the digest comparison are
 * constant-time to avoid leaking the expected signature byte by byte.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-voltbets-signature";
export const TIMESTAMP_HEADER = "x-voltbets-timestamp";
export const EVENT_ID_HEADER = "x-voltbets-event-id";

/** Requests older/newer than this are rejected (clock-skew + replay window). */
export const MAX_SKEW_SECONDS = 300;

/** Compute the expected signature for a body. Exported for the worker's tests. */
export function signSettlementBody(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/** Constant-time hex-digest comparison that tolerates malformed input. */
function digestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type VerifyResult = { ok: true } | { ok: false; status: 401 | 503; reason: string };

/**
 * Verify a signed settlement request.
 * Returns 503 when the secret is not configured (fail closed — an unconfigured
 * webhook must not accept anything), 401 for anything that does not verify.
 */
export function verifySettlementSignature(opts: {
  secret: string | null | undefined;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: number;
}): VerifyResult {
  const { secret, timestamp, signature, rawBody } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  if (!secret || secret.length < 16) {
    return { ok: false, status: 503, reason: "settlement webhook secret not configured" };
  }
  if (!timestamp || !signature) {
    return { ok: false, status: 401, reason: "missing signature headers" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, reason: "bad timestamp" };
  }
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "timestamp outside replay window" };
  }

  // Accept both the bare hex digest and the `sha256=<hex>` form (GitHub/Stripe
  // convention) so operators can test with either.
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = signSettlementBody(secret, timestamp, rawBody);
  if (!digestsMatch(provided.toLowerCase(), expected)) {
    return { ok: false, status: 401, reason: "signature mismatch" };
  }
  return { ok: true };
}
