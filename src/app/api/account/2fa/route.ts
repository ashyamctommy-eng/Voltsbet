import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { generateTotpSecret, verifyTotp, otpauthUrl } from "@/lib/2fa";

/**
 * 2FA enrollment/management — available to any user (TOTP via authenticator app).
 * GET  → status + enrollment QR (secret persisted until enabled)
 * POST → enable with a verified 6-digit code
 * DELETE → disable
 */
export const GET = handle(async () => {
  const user = await requireUser();

  let secret = user.totpSecret;
  if (!user.totpEnabled && !secret) {
    secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
  }

  const payload: Record<string, unknown> = { enabled: user.totpEnabled };
  if (!user.totpEnabled && secret) {
    const uri = otpauthUrl(secret, user.username);
    const qr = await QRCode.toDataURL(uri, { width: 220, margin: 1 });
    payload.secret = secret;
    payload.otpauthUrl = uri;
    payload.qrDataUrl = qr;
  }
  return ok(payload);
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  if (user.totpEnabled) throw new ApiError(409, "2FA is already enabled.", "ALREADY_ENABLED");
  if (!user.totpSecret) throw new ApiError(400, "Request a QR code first.", "NO_SECRET");

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim();
  if (!verifyTotp(user.totpSecret, code)) {
    throw new ApiError(400, "Invalid code — check your authenticator app.", "BAD_TOTP");
  }

  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  return ok({ enabled: true, message: "2FA enabled. You'll need a code on every login." });
});

export const DELETE = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();

  // Disabling 2FA requires a valid TOTP code — a stolen session alone must
  // not be able to silently strip the second factor.
  if (!user.totpEnabled) throw new ApiError(400, "2FA is not enabled.", "NOT_ENABLED");
  if (!user.totpSecret) throw new ApiError(400, "No 2FA secret on file.", "NO_SECRET");

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim();
  if (!verifyTotp(user.totpSecret, code)) {
    throw new ApiError(400, "Invalid code — enter a current 6-digit code from your authenticator app.", "BAD_TOTP");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  return ok({ enabled: false, message: "2FA disabled." });
});
