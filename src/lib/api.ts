import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, getCsrfToken, makeToken, CSRF_COOKIE } from "./auth";
import { prisma } from "./prisma";
import type { User } from "@prisma/client";

export class ApiError extends Error {
  status: number;
  code: string;
  data?: unknown;
  constructor(status: number, message: string, code = "ERROR", data?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function ok(data: unknown = {}, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>), ...extra });
}

export function fail(status: number, message: string, code = "ERROR") {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export type RouteCtx = { params: Promise<Record<string, string | string[]>> };

export function handle<C = RouteCtx>(fn: (req: NextRequest, ctx: C) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json(
          { ok: false, error: { code: e.code, message: e.message }, data: e.data ?? null },
          { status: e.status }
        );
      }
      console.error("[api]", e);
      // Never leak internal errors to clients
      return fail(500, "Something went wrong. Please try again.", "INTERNAL");
    }
  };
}

/** Enforce double-submit CSRF on state-changing requests. */
export async function verifyCsrf(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const cookie = await getCsrfToken();
  const header = req.headers.get("x-csrf-token") ?? "";
  const sameOrigin =
    req.headers.get("sec-fetch-site") === "same-origin" ||
    req.headers.get("sec-fetch-site") === "none" ||
    req.headers.get("sec-fetch-site") === null;
  if (!sameOrigin) {
    throw new ApiError(403, "Invalid or missing CSRF token. Refresh the page and try again.", "CSRF");
  }
  if (cookie.length >= 16 && header === cookie) return;

  // Self-heal: same-origin request with a valid session but a missing CSRF
  // cookie (e.g. a browser restart before this fix dropped the session-cookie
  // CSRF token) — issue a fresh token instead of a dead-end 403. A cookie
  // MISMATCH (header present, wrong value) is still rejected.
  if (cookie.length < 16 && header.length < 16) {
    const user = await getCurrentUser();
    if (user) {
      const store = await cookies();
      store.set(CSRF_COOKIE, makeToken(), {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires: new Date(Date.now() + 30 * 86400_000),
      });
      return;
    }
  }
  throw new ApiError(403, "Invalid or missing CSRF token. Refresh the page and try again.", "CSRF");
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Please log in to continue.", "UNAUTHORIZED");
  return user;
}

/** RBAC matrix — role → allowed resources. SUPER_ADMIN implicitly has all. */
const RESOURCES = [
  "dashboard", "sports", "games", "markets", "odds", "results", "live",
  "settlements", "bets", "deposits", "withdrawals", "transactions", "crypto",
  "currencies", "languages", "promotions", "banners",
  "users", "notifications", "support", "settings", "statuses", "audit",
] as const;
export type Resource = (typeof RESOURCES)[number];

const ROLE_RESOURCES: Record<string, Resource[]> = {
  SUPER_ADMIN: [...RESOURCES],
  SPORTS_MANAGER: ["dashboard", "sports", "games", "markets", "odds", "results", "live", "settlements", "bets"],
  FINANCE_MANAGER: ["dashboard", "deposits", "withdrawals", "transactions", "crypto", "currencies", "users", "bets"],
  SUPPORT_MANAGER: ["dashboard", "users", "notifications", "support"],
  CONTENT_MANAGER: ["dashboard", "promotions", "banners", "languages"],
};

export function can(role: string, resource: Resource) {
  return ROLE_RESOURCES[role]?.includes(resource) ?? false;
}

export async function requireAdmin(resource: Resource): Promise<User> {
  const user = await requireUser();
  if (user.role === "CUSTOMER" || !can(user.role, resource)) {
    throw new ApiError(403, "You do not have permission to perform this action.", "FORBIDDEN");
  }
  // A suspended/locked admin loses ALL access (reads included) — a live
  // session must not keep opening admin data after the account is disabled.
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, "Your account is not active. Contact support.", "ACCOUNT_INACTIVE");
  }
  return user;
}

/** Log an admin action to the immutable audit trail. */
export async function auditLog(opts: {
  admin: { id: string; username: string };
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  gameId?: string;
  prevValue?: unknown;
  newValue?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      adminId: opts.admin.id,
      adminName: opts.admin.username,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId,
      userId: opts.userId,
      gameId: opts.gameId,
      prevValue: opts.prevValue !== undefined ? JSON.stringify(opts.prevValue) : null,
      newValue: opts.newValue !== undefined ? JSON.stringify(opts.newValue) : null,
    },
  });
}
