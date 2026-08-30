import { generateSecret, generateURI, verifySync } from "otplib";

/**
 * TOTP two-factor authentication (RFC 6238) for admin/non-customer roles.
 * Enrollment flow: generate secret → show otpauth:// QR → user scans in an
 * authenticator app → verify a code → enable. Secrets are stored per-user.
 * Uses otplib v13 functional API (Google Authenticator compatible).
 */

const ISSUER = "VoltBet";

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export function verifyTotp(secret: string, token: string): boolean {
  if (!token || !/^\d{6}$/.test(token)) return false;
  try {
    // epochTolerance: 30 → accept ±1 time step (30s) to absorb clock skew
    // between the server and the user's authenticator app.
    const res = verifySync({ strategy: "totp", secret, token, epochTolerance: 30 });
    return res.valid === true;
  } catch {
    return false;
  }
}

export function otpauthUrl(secret: string, account: string): string {
  return generateURI({ strategy: "totp", issuer: ISSUER, label: account, secret });
}
