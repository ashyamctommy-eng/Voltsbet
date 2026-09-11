import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (Next 16's rename of middleware; runs on the Node runtime).
 *
 * Its one job here: a hard, DB-independent MAINTENANCE_MODE kill-switch. It is
 * intentionally dependency-free so it still works when the database is down —
 * which is exactly when you reach for it.
 *
 *   MAINTENANCE_MODE=1   →  pages are rewritten to /maintenance (with a
 *                           Retry-After header), API calls get a 503 JSON.
 *
 * Always allowed through: the health probe (Railway must see it), cron,
 * provider webhooks and the maintenance page itself. Turning the env var off
 * (and redeploying) restores normal service.
 *
 * NOTE: this is for *planned* maintenance. It cannot help during a deploy
 * window where the process is not running — nothing in the app can; that is
 * what the Railway healthcheck (`/api/health`) is for.
 */

const MAINTENANCE = process.env.MAINTENANCE_MODE === "1" || process.env.MAINTENANCE_MODE === "true";

/** Paths that must keep working even in maintenance (health, crons, callbacks). */
function alwaysAllowed(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/maintenance" ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/webhooks") ||
    // Machine-to-machine settlement intake must keep working while the
    // customer-facing site is in maintenance.
    pathname.startsWith("/api/v1") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!MAINTENANCE) {
    // Forward the pathname as a request header so server components can make
    // path-aware decisions — the root-layout maintenance gate uses it to keep
    // /login and /admin reachable (so staff can sign in and turn maintenance
    // back OFF). Cheap: no DB access here.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (alwaysAllowed(pathname)) return NextResponse.next();

  // API clients get a machine-readable 503 instead of an HTML page.
  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: { code: "MAINTENANCE", message: "Scheduled maintenance — please try again shortly." } },
      { status: 503, headers: { "retry-after": "300", "cache-control": "no-store" } }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  const res = NextResponse.rewrite(url);
  res.headers.set("retry-after", "300");
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-maintenance", "1");
  return res;
}

export const config = {
  matcher: [
    // Everything except Next's static assets and public files (they must load
    // for the maintenance page to render styled).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|map)$).*)",
  ],
};
