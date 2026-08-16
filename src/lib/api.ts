import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getCsrfToken } from "./auth";
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

export function handle(fn: (req: NextRequest, ctx: any) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: any) => {
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
  if (!cookie || cookie.length < 16 || header !== cookie || !sameOrigin) {
    throw new ApiError(403, "Invalid or missing CSRF token. Refresh the page and try again.", "CSRF");
  }
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
  "currencies", "languages", "promotions", "testimonials", "banners",
  "users", "notifications", "support", "settings", "statuses", "audit",
] as const;
export type Resource = (typeof RESOURCES)[number];

const ROLE_RESOURCES: Record<string, Resource[]> = {
  SUPER_ADMIN: [...RESOURCES],
  SPORTS_MANAGER: ["dashboard", "sports", "games", "markets", "odds", "results", "live", "settlements", "bets"],
  FINANCE_MANAGER: ["dashboard", "deposits", "withdrawals", "transactions", "crypto", "currencies", "users", "bets"],
  SUPPORT_MANAGER: ["dashboard", "users", "notifications", "support"],
  CONTENT_MANAGER: ["dashboard", "promotions", "testimonials", "banners", "languages"],
};

export function can(role: string, resource: Resource) {
  return ROLE_RESOURCES[role]?.includes(resource) ?? false;
}

export async function requireAdmin(resource: Resource): Promise<User> {
  const user = await requireUser();
  if (user.role === "CUSTOMER" || !can(user.role, resource)) {
    throw new ApiError(403, "You do not have permission to perform this action.", "FORBIDDEN");
  }
  return user;
}

/** Log an admin action to the immutable audit trail. */
export async function auditLog(opts: {
  admin: User;
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
