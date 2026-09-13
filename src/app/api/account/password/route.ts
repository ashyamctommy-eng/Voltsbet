/**
 * POST /api/account/password — change the signed-in customer's own password.
 *
 * Path A: current-password verification only. No SMS or email provider is
 * involved, so this works on any deployment including a fresh self-hosted one.
 *
 * Rate-limited per USER (not just per IP): the check being attacked here is
 * "do you know the current password", so the counter has to follow the account.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { changePassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

/** Mirrors the registration policy exactly — one password rule, one place. */
const schema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[a-zA-Z]/, "Must contain a letter")
    .regex(/[0-9]/, "Must contain a number"),
});

const REASONS: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Account not found."],
  BAD_CURRENT: [401, "That isn't your current password."],
  UNCHANGED: [400, "Your new password must be different from your current one."],
};

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();

  const rl = rateLimit(`pwchange:${user.id}`, 5, 15 * 60_000);
  if (!rl.ok) throw new ApiError(429, "Too many attempts. Try again in a few minutes.", "RATE_LIMITED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const res = await changePassword({
    userId: user.id,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });
  if (!res.ok) {
    const [status, message] = REASONS[res.reason];
    throw new ApiError(status, message, res.reason);
  }

  // With no mail provider configured, the in-app notification IS the "if this
  // wasn't you" signal. Cheap, and it cannot be missed in a spam folder.
  await prisma.notification.create({
    data: {
      userId: user.id,
      title: "Your password was changed",
      message:
        "If you did not make this change, contact support immediately. All other devices have been signed out.",
      type: "SECURITY",
    },
  });

  return ok({
    message:
      res.revoked > 0
        ? `Password updated. ${res.revoked} other device${res.revoked === 1 ? "" : "s"} signed out.`
        : "Password updated.",
    sessionsRevoked: res.revoked,
  });
});
