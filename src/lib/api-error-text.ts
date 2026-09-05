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
  BETTING_LOCKED: "err.bettingLocked",
  CASHOUT_DISABLED: "err.cashoutDisabled",
  MPESA_DISABLED: "err.mpesaDisabled",
  MPESA_WITHDRAWALS_DISABLED: "err.mpesaWithdrawalsDisabled",
  MPESA_UNCONFIGURED: "err.mpesaUnconfigured",
  VOUCHER_DISABLED: "err.voucherDisabled",
  INVALID_VOUCHER: "err.invalidVoucher",
  ALREADY_REDEEMED: "err.alreadyRedeemed",
  EXPIRED: "err.voucherExpired",
  SUSPENDED: "err.voucherSuspended",
  CANCELLED: "err.voucherCancelled",
  EMPTY_SLIP: "err.emptySlip",
  SELECTION_GONE: "err.selectionGone",
  DUPLICATE_BET: "err.duplicateBet",
  OTP_RATE_LIMITED: "err.otpRateLimited",
  TELEGRAM_NOT_LINKED: "err.telegramNotLinked",
  ACCOUNT_INACTIVE: "err.accountInactive",
  INVALID_AMOUNT: "err.invalidAmount",
  INVALID_STAKE: "err.invalidStake",
  MAX_DEPOSIT: "err.maxDeposit",
  NOT_CANCELLABLE: "err.notCancellable",
  WINDOW_EXPIRED: "err.windowExpired",
  DEPOSIT_LOCKED: "err.depositLocked",
};

export function apiErrorText(t: Translate, code?: string, fallbackMessage?: string): string {
  const key = code ? CODE_TO_KEY[code] : undefined;
  if (key) return t(key);
  return fallbackMessage ?? "";
}
