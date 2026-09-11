import { NextRequest } from "next/server";
import { randomInt } from "crypto";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

/**
 * POST /api/admin/users/[id]/reset-password — reset a CUSTOMER's password to a
 * freshly generated temporary one.
 *
 * The temp password is returned ONCE in the response (never stored in plain
 * text) for the admin to hand to the user; the user changes it at
 * Account → Settings. Every live session is revoked so a compromised login
 * cannot survive the reset, and the action is written to the audit trail.
 */

// Confusion-free alphabet (no 0/O/1/I/l) — easy to read over the phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function tempPassword(length = 12): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) chars.push(ALPHABET[randomInt(ALPHABET.length)]);
  // Guarantee the shape the signup policy expects: letters + at least one digit.
  chars[0] = "ABCDEFGHJKLMNPQRSTUVWXYZ"[randomInt(24)];
  chars[1] = "2345678923456789"[randomInt(16)];
  return chars.join("");
}

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "users");
  const { id } = await ctx.params;

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, username: true } });
  if (!user) throw new ApiError(404, "User not found.", "NOT_FOUND");
  if (user.role !== "CUSTOMER") {
    throw new ApiError(403, "Staff passwords cannot be reset here.", "FORBIDDEN");
  }

  const password = tempPassword();
  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
    // Kill every existing session — a reset must invalidate live logins.
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.notification.create({
      data: {
        userId: id,
        type: "ACCOUNT",
        title: "Password Reset",
        message:
          "An administrator reset your password. Sign in with the temporary password you were given and change it in Account → Settings.",
      },
    }),
  ]);

  await auditLog({
    admin,
    action: "RESET_PASSWORD",
    entity: "USER",
    entityId: id,
    userId: id,
    newValue: { username: user.username, sessionsRevoked: true },
  });

  // Returned once, for the admin to relay. Never logged or persisted.
  return ok({ tempPassword: password });
});
