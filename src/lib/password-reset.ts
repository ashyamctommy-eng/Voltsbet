/**
 * Self-service password reset over Telegram.
 *
 * Email/SMS are deliberately NOT used: there is no mail transport, free SMS for
 * auth does not exist, and Telegram is already built (`lib/telegram.ts` —
 * purpose-aware codes, hashed, per-purpose rate-limited, supersede-on-reissue).
 * It is also a *possession* factor, which is stronger than email.
 *
 * Two rules that matter more than the mechanism:
 *  1. NEVER reveal whether an account exists. Callers get the same shape whether
 *     or not the identifier resolves, and whether or not Telegram is linked.
 *  2. A completed reset revokes EVERY session. That is what actually helps
 *     someone who believes they are compromised.
 */
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { issueTelegramOtp, verifyTelegramOtp } from "@/lib/telegram";

/** Resolve an email or username to a user, without leaking existence outward. */
async function findByIdentifier(identifier: string) {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  return prisma.user.findFirst({
    where: { OR: [{ email: id }, { username: id }] },
    select: { id: true, telegramChatId: true, status: true },
  });
}

export type ResetRequestResult = {
  /** True only when a code was actually dispatched — never surfaced as-is. */
  sent: boolean;
  /** Why nothing was sent, for logging/support (NOT returned to the client). */
  reason?: "NO_ACCOUNT" | "NO_TELEGRAM" | "BLOCKED";
};

export async function requestReset(identifier: string): Promise<ResetRequestResult> {
  const user = await findByIdentifier(identifier);
  if (!user) return { sent: false, reason: "NO_ACCOUNT" };
  // A suspended account must not be able to regain access this way.
  if (user.status !== "ACTIVE") return { sent: false, reason: "BLOCKED" };
  if (!user.telegramChatId) return { sent: false, reason: "NO_TELEGRAM" };

  await issueTelegramOtp(user.id, "PASSWORD_RESET");
  return { sent: true };
}

export type ResetCompleteResult =
  | { ok: true }
  | { ok: false; reason: "NO_ACCOUNT" | "NO_TELEGRAM" | "BLOCKED" | "BAD_CODE" };

export async function completeReset(
  identifier: string,
  code: string,
  newPassword: string,
): Promise<ResetCompleteResult> {
  const user = await findByIdentifier(identifier);
  if (!user) return { ok: false, reason: "NO_ACCOUNT" };
  if (user.status !== "ACTIVE") return { ok: false, reason: "BLOCKED" };
  if (!user.telegramChatId) return { ok: false, reason: "NO_TELEGRAM" };

  // verifyTelegramOtp checks the hash, the TTL and the purpose, and consumes
  // the code so a replayed request cannot succeed twice.
  if (!(await verifyTelegramOtp(user.id, "PASSWORD_RESET", code))) {
    return { ok: false, reason: "BAD_CODE" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
    // A reset is the "I think I'm compromised" path: everything signs out,
    // including whatever device initiated it.
  });
  const revoked = await prisma.session.deleteMany({ where: { userId: user.id } });

  await prisma.notification.create({
    data: {
      userId: user.id,
      title: "Your password was reset",
      message:
        revoked.count > 0
          ? `All ${revoked.count} device${revoked.count === 1 ? "" : "s"} were signed out. If this wasn't you, contact support immediately.`
          : "If this wasn't you, contact support immediately.",
      type: "SECURITY",
    },
  });
  return { ok: true };
}
