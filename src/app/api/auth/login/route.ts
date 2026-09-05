import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, ApiError } from "@/lib/api";
import { verifyPassword, createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { issueTelegramOtp, verifyTelegramOtp } from "@/lib/telegram";
import { requireRecaptcha } from "@/lib/recaptcha";

const schema = z.object({
  identifier: z.string().min(1, "Enter your username or email"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean().optional().default(false),
  otp: z.string().optional().default(""),
  gRecaptchaToken: z.string().optional().default(""),
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const POST = handle(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`login:${ip}`, 15, 15 * 60_000);
  if (!rl.ok) throw new ApiError(429, "Too many login attempts. Try again later.", "RATE_LIMITED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const { identifier, password, remember, otp, gRecaptchaToken } = parsed.data;

  // Bot protection on every auth attempt (credentials AND the OTP follow-up):
  // tokens are single-use, so the second step carries a freshly solved one.
  await requireRecaptcha(gRecaptchaToken);

  const id = identifier.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: id }, { email: id }] },
  });

  const badLogin = async () => {
    await prisma.auditLog.create({
      data: { action: "LOGIN_FAILED", entity: "USER", entityId: user?.id, ip },
    });
    throw new ApiError(401, "Invalid username/email or password.", "BAD_CREDENTIALS");
  };

  // ── Brute-force lockout (per account) ──────────────────────
  if (user && user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new ApiError(423, `Too many failed attempts. Account locked for ${mins} more minutes.`, "ACCOUNT_LOCKED");
  }

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    if (user) {
      const failed = user.failedLogins + 1;
      const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          // Keep counting past the lock — resetting to 0 at lock time used to
          // grant a fresh 5 tries per 15-minute window, forever.
          failedLogins: failed,
          ...(lockedUntil ? { lockedUntil } : {}),
        },
      });
    }
    return badLogin();
  }

  // ── Telegram OTP (accounts with a linked Telegram chat) ────
  // Replaces TOTP 2FA: a 6-digit code is pushed to the user's Telegram DM
  // via the Bot API. Only runs after a CORRECT password, so attackers can't
  // spam codes to arbitrary users.
  const settings = await getSettings();
  if (settings.telegramOtpEnabled && user.telegramChatId) {
    if (!otp) {
      await issueTelegramOtp(user.id, "LOGIN");
      return ok({
        otpRequired: true,
        channel: "TELEGRAM",
        message: "We sent a 6-digit code to your Telegram. Enter it to finish logging in.",
      });
    }
    if (!(await verifyTelegramOtp(user.id, "LOGIN", otp))) {
      // A wrong OTP counts toward the same per-account lockout as a wrong
      // password — without this, OTP brute force only faced the IP limiter.
      const failed = user.failedLogins + 1;
      const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, ...(lockedUntil ? { lockedUntil } : {}) },
      });
      throw new ApiError(401, "Invalid or expired verification code.", "OTP_INVALID");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
  });
  await createSession(user.id, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    remember,
  });

  return ok({
    user: { id: user.id, username: user.username, role: user.role },
    redirect: user.role !== "CUSTOMER" ? "/admin" : "/",
  });
});
