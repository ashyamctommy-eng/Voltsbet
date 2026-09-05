import { ApiError } from "./api";

/**
 * Google reCAPTCHA v2 ("I'm not a robot") server-side verification.
 *
 * Env:
 *   - NEXT_PUBLIC_RECAPTCHA_SITE_KEY — client widget key (public)
 *   - RECAPTCHA_SECRET_KEY           — server verification key
 *
 * Behavior: when RECAPTCHA_SECRET_KEY is NOT configured (fresh clone, local
 * dev, or self-hosted without bot protection), verification is skipped so
 * auth keeps working. Once the secret is set, every register/login attempt
 * must carry a valid `g-recaptcha-response` token — otherwise the request is
 * rejected before any credentials are processed.
 */
export async function verifyRecaptchaToken(token: string | null | undefined): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true; // not configured → skip (dev / self-hosted)
  if (!token) return false;

  const params = new URLSearchParams({ secret, response: token });
  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Enforce reCAPTCHA on an auth request; throws when the token is missing/invalid. */
export async function requireRecaptcha(token?: string | null): Promise<void> {
  if (await verifyRecaptchaToken(token)) return;
  throw new ApiError(400, "Bot check failed — please complete the reCAPTCHA and try again.", "RECAPTCHA_FAILED");
}
