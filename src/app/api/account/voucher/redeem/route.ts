import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { redeemVoucher } from "@/lib/vouchers";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * POST /api/account/voucher/redeem — redeem a deposit voucher.
 *
 * Anti-brute-force: per-user + per-IP rate limits, plus a consecutive-failure
 * lockout (10 bad attempts → 15 min block). Failed attempts are audited (the
 * raw code is never logged). All validation happens server-side.
 */

const schema = z.object({ code: z.string().min(1, "Enter your voucher code").max(64) });

const PER_WINDOW = 5; // redemption attempts per window
const WINDOW_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 10;
const LOCK_MS = 15 * 60_000;

/** Consecutive-failure tracking per user (in-memory; fine single-instance). */
const failures = new Map<string, { count: number; lockedUntil: number }>();

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Consecutive-failure lockout (per user).
  const rec = failures.get(user.id);
  if (rec && rec.lockedUntil > Date.now()) {
    throw new ApiError(429, "Too many invalid attempts — try again in a few minutes.", "LOCKED");
  }

  // Per-user and per-IP rate limits.
  const rlUser = rateLimit(`voucher:user:${user.id}`, PER_WINDOW, WINDOW_MS);
  const rlIp = rateLimit(`voucher:ip:${ip}`, PER_WINDOW * 3, WINDOW_MS);
  if (!rlUser.ok || !rlIp.ok) {
    throw new ApiError(429, "Too many attempts — wait a moment and try again.", "RATE_LIMITED");
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Enter your voucher code.", "VALIDATION");

  try {
    const result = await redeemVoucher(user, parsed.data.code, {
      ip,
      deviceInfo: req.headers.get("user-agent") ?? undefined,
    });
    // Success clears the failure streak.
    failures.delete(user.id);
    return ok(result);
  } catch (e) {
    if (e instanceof ApiError && (e.code === "INVALID_VOUCHER" || e.code === "ALREADY_REDEEMED" || e.code === "EXPIRED" || e.code === "CANCELLED" || e.code === "SUSPENDED" || e.code === "CURRENCY_MISMATCH" || e.code === "MAX_DEPOSIT")) {
      const f = failures.get(user.id) ?? { count: 0, lockedUntil: 0 };
      const count = f.count + 1;
      if (count >= MAX_CONSECUTIVE_FAILURES) {
        failures.set(user.id, { count: 0, lockedUntil: Date.now() + LOCK_MS });
      } else {
        failures.set(user.id, { count, lockedUntil: 0 });
      }
    }
    throw e;
  }
});
