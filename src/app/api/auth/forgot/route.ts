/**
 * POST /api/auth/forgot — request a password-reset code over Telegram.
 *
 * The response is IDENTICAL whether the identifier exists, is suspended, or has
 * no Telegram linked. That is the whole point: a reset form that answers
 * "no such account" is an account-enumeration oracle.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { requestReset } from "@/lib/password-reset";

const schema = z.object({ identifier: z.string().min(1, "Enter your email or username") });

const GENERIC =
  "If that account exists and has Telegram linked, a reset code is on its way. Not linked? Contact support.";

export const POST = handle(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`forgot:${ip}`, 10, 15 * 60_000);
  if (!rl.ok) throw new ApiError(429, "Too many requests. Try again later.", "RATE_LIMITED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  // Result deliberately discarded — see the note above.
  await requestReset(parsed.data.identifier).catch(() => null);
  return ok({ message: GENERIC });
});
