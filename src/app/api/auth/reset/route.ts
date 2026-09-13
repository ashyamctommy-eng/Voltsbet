/**
 * POST /api/auth/reset — complete a Telegram-assisted password reset.
 *
 * On success every session is revoked, so the customer must sign in again with
 * the new password. The code is consumed by verifyTelegramOtp, so a replayed
 * request cannot succeed twice.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { completeReset } from "@/lib/password-reset";

const schema = z.object({
  identifier: z.string().min(1, "Enter your email or username"),
  code: z.string().min(4, "Enter the code from Telegram"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[a-zA-Z]/, "Must contain a letter")
    .regex(/[0-9]/, "Must contain a number"),
});

export const POST = handle(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`reset:${ip}`, 10, 15 * 60_000);
  if (!rl.ok) throw new ApiError(429, "Too many attempts. Try again later.", "RATE_LIMITED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const res = await completeReset(parsed.data.identifier, parsed.data.code, parsed.data.newPassword);
  if (!res.ok) {
    // A wrong code is the only outcome worth naming; the rest stay generic so
    // this endpoint is not an enumeration oracle either.
    const message =
      res.reason === "BAD_CODE"
        ? "That code is wrong or has expired. Request a new one."
        : "We couldn't complete that reset. Contact support.";
    throw new ApiError(res.reason === "BAD_CODE" ? 400 : 404, message, res.reason);
  }
  return ok({ message: "Password updated. Sign in with your new password." });
});
