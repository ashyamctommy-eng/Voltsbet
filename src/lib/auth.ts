import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "vb_session";
export const CSRF_COOKIE = "vb_csrf";
const SESSION_DAYS = 7;
const REMEMBER_DAYS = 30;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
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
    data: { token, userId, ip: opts.ip, userAgent: opts.userAgent, expiresAt },
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
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
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
    await prisma.session.deleteMany({ where: { token } });
  }
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

export async function getCsrfToken() {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? "";
}
