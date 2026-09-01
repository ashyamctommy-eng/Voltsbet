import { randomBytes } from "crypto";

/**
 * PalPlus auto-ref withdrawal reference generator.
 *
 * Format: `PLP-WDR-XXXXXXXX` — 8 uppercase alphanumeric chars from a
 * confusion-free alphabet (no 0/O/1/I). Uniqueness is guaranteed by the
 * Withdrawal.trackingId unique column + the collision-retry loop in the
 * creation route (see src/app/api/account/withdraw/route.ts).
 */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateWithdrawalRef(): string {
  const suffix = Array.from(randomBytes(8))
    .map((b) => REF_ALPHABET[b % REF_ALPHABET.length])
    .join("");
  return `PLP-WDR-${suffix}`;
}

/** Validate a generated ref shape (used by tests + admin tooling). */
export function isWithdrawalRef(value: string): boolean {
  return /^PLP-WDR-[A-HJ-NP-Z2-9]{8}$/.test(value);
}
