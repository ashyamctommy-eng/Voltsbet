import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "vb_session";
export const CSRF_COOKIE = "vb_csrf";
const SESSION_DAYS = 7;
const REMEMBER_DAYS = 30;

/**
 * Sessions are stored HASHED (sha256) in the DB — never the raw token — so a
 * database leak cannot be replayed into live sessions. The raw token is only
 * ever sent to the browser (HttpOnly cookie).
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(pw: string) {
  // Cost 12 — OWASP-recommended for 2026; cost 10 is the historical default
  // and too fast on modern GPUs for a real-money platform.
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function makeToken() {
  return randomBytes(32).toString("hex");
}

export async function createSession(
  userId: string,
  opts: { ip?: string; userAgent?: string; remember?: boolean } = {}
) {
  const token = makeToken();
  const days = opts.remember ? REMEMBER_DAYS : SESSION_DAYS;
  const expiresAt = new Date(Date.now() + days * 86400_000);

  await prisma.session.create({
    data: { token: hashToken(token), userId, ip: opts.ip, userAgent: opts.userAgent, expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  // CSRF double-submit token (non-HttpOnly so client JS can echo it).
  // Lifetime matches the session cookie — otherwise a browser restart keeps
  // you logged in (persistent session) but drops the CSRF cookie, breaking
  // every state-changing admin action with INVALID CSRF.
  const csrf = makeToken();
  store.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  let session = await prisma.session.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  });
  // Legacy plaintext sessions from before this fix — match on the raw token
  // and migrate the row to the hashed form on first use.
  if (!session) {
    session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (session) {
      await prisma.session
        .update({ where: { id: session.id }, data: { token: tokenHash } })
        .catch(() => {});
    }
  }
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    store.delete(SESSION_COOKIE);
    return null;
  }
  return session.user;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({
      where: { token: { in: [hashToken(token), token] } }, // hashed + legacy plaintext
    });
  }
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

export async function getCsrfToken() {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? "";
}
