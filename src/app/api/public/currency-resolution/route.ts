/**
 * Public currency-resolution endpoint — the single source of truth for the
 * visitor's ACTIVE currency, in priority order:
 *
 *   1. forceDefaultCurrency (admin)  → settings.currencyDefault
 *   2. signed-in user preference     → user.displayCurrencyCode
 *   3. IP auto-detect                → ipapi.co (currency field), server-side
 *   4. fallback                      → USD (lookup failed / timeout)
 *
 * The client (CurrencyProvider) consumes this to set activeCurrency globally.
 */
import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";

const IPAPI_TIMEOUT_MS = 3000;

function forwardedIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && first !== "unknown") return first;
  }
  return req.headers.get("x-real-ip");
}

/** Resolve the caller's currency via ipapi.co. Returns ISO code or null. */
async function ipCurrency(ip: string | null): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), IPAPI_TIMEOUT_MS);
    // With a forwarded client IP use the IP path; otherwise ipapi resolves
    // the caller (our server egress) itself.
    const url = ip
      ? `https://ipapi.co/${encodeURIComponent(ip)}/json/?fields=currency`
      : "https://ipapi.co/json/?fields=currency";
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { currency?: unknown };
    const c = j?.currency;
    return typeof c === "string" && /^[A-Z]{3}$/.test(c) ? c : null;
  } catch {
    return null;
  }
}

export const GET = handle(async (req: NextRequest) => {
  const settings = await getSettings();

  // 1) Admin force-default wins over everything.
  if (settings.forceDefaultCurrency) {
    return ok({ code: settings.currencyDefault, source: "force-default" });
  }

  // 2) Signed-in user's saved display preference.
  const user = await getCurrentUser();
  if (user?.displayCurrencyCode) {
    return ok({ code: user.displayCurrencyCode, source: "user-preference" });
  }

  // 3) IP auto-detect (forwarded headers → ipapi.co).
  const ipCur = await ipCurrency(forwardedIp(req));
  if (ipCur) {
    return ok({ code: ipCur, source: "ip" });
  }

  // 4) Fallback: USD (lookup failed or timed out).
  return ok({ code: "USD", source: "fallback-usd" });
});
