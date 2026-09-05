/**
 * Server-error → localized text.
 *
 * API routes throw `ApiError(status, message, code)` and the client receives
 * `{ error: { code, message } }`. The `message` is always English, so pages
 * map a known set of stable codes to i18n keys (translated in each pack).
 * Codes NOT in the map fall back to the server's English message — perfect
 * coverage is impossible until every ApiError carries a key, so we localize
 * the high-traffic auth/wallet codes first.
 *
 * Usage in a client component:
 *   setError(apiErrorText(t, res.error.code, res.error.message));
 */
type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** ApiError `code` → i18n key (namespace `err.*`). */
const CODE_TO_KEY: Record<string, string> = {
  RATE_LIMITED: "err.rateLimited",
  EMAIL_TAKEN: "err.emailTaken",
  USERNAME_TAKEN: "err.usernameTaken",
  PHONE_TAKEN: "err.phoneTaken",
  BAD_CREDENTIALS: "err.badCredentials",
  ACCOUNT_LOCKED: "err.accountLocked",
  OTP_INVALID: "err.otpInvalid",
  RECAPTCHA_FAILED: "err.recaptchaFailed",
  INSUFFICIENT_BALANCE: "err.insufficient",
  NO_WALLET: "err.noWallet",
};

export function apiErrorText(t: Translate, code?: string, fallbackMessage?: string): string {
  const key = code ? CODE_TO_KEY[code] : undefined;
  if (key) return t(key);
  return fallbackMessage ?? "";
}
