import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { getSettings, setSetting, invalidateSettingsCache } from "@/lib/settings";
import { revalidatePath } from "next/cache";

/**
 * Admin Odds engine configuration (Admin → API Settings → Odds engine).
 *
 * Every knob here is DB-driven (per-client) with the ODDS_API_* env var
 * acting as a hard override when set. GET also reports the LIVE credit
 * quota (read via the free /v4/sports call, cached 60s) so the admin can
 * always see the remaining balance next to the cost of the current config.
 *
 * Stored DB keys (all optional; empty/absent = provider default):
 *   odds.regions             "eu" | "us" | "eu,us"        (6 cr/league on eu,us, 3 on eu)
 *   odds.rateLimitMs          ms between API requests
 *   odds.eventBookmakers      deep-pass books, e.g. "bovada,pinnacle"
 *   odds.markets              market keys (CSV/JSON; empty = built-in menu)
 *   odds.feedMaxLeagues       catalog-mode league cap per run
 *   odds.eventMarketLimit     deep-pass fixtures per featured league (0 = off)
 *   odds.eventMarketLeagues   featured leagues for the deep pass (CSV/JSON)
 *   odds.syncLeagues          league sync whitelist (managed on the same page)
 */
let quotaCache: { at: number; used: number; remaining: number } | null = null;
const QUOTA_TTL_MS = 60_000;

async function fetchQuota(): Promise<{ used: number; remaining: number } | null> {
  if (quotaCache && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
    return { used: quotaCache.used, remaining: quotaCache.remaining };
  }
  const key = process.env.ODDS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${key}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const used = Number(res.headers.get("x-requests-used") ?? 0);
    const remaining = Number(res.headers.get("x-requests-remaining") ?? 0);
    quotaCache = { at: Date.now(), used, remaining };
    return { used, remaining };
  } catch {
    return null;
  }
}

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const s = await getSettings();
  const quota = await fetchQuota();

  const env = {
    regions: process.env.ODDS_API_REGIONS,
    rateLimitMs: process.env.ODDS_API_RATE_LIMIT_MS,
    eventBookmakers: process.env.ODDS_API_EVENT_BOOKMAKERS,
    markets: process.env.ODDS_API_MARKETS,
    feedMaxLeagues: process.env.ODDS_API_FEED_MAX_LEAGUES,
    eventMarketLimit: process.env.ODDS_API_EVENT_MARKET_LIMIT,
    eventMarketLeagues: process.env.ODDS_API_EVENT_MARKET_LEAGUES,
  };

  return ok({
    stored: {
      regions: s.oddsRegions,
      rateLimitMs: s.oddsRateLimitMs,
      eventBookmakers: s.oddsEventBookmakers,
      markets: s.oddsMarkets,
      feedMaxLeagues: s.oddsFeedMaxLeagues,
      eventMarketLimit: s.oddsEventMarketLimit,
      eventMarketLeagues: s.oddsEventMarketLeagues,
      syncLeagues: s.oddsSyncLeagues ?? [],
    },
    env,
    quota,
  });
});

export const PUT = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "Send a settings object.", "BAD_BODY");
  }

  const regions = String(body.regions ?? "");
  if (regions && !["eu", "us", "eu,us"].includes(regions)) {
    throw new ApiError(400, "regions must be one of: eu, us, eu,us", "BAD_REGIONS");
  }
  const num = (v: unknown, min = 0): string => {
    const n = Number(v);
    if (v === "" || v === undefined || v === null) return "";
    if (!Number.isFinite(n) || n < min) throw new ApiError(400, `Invalid number: ${String(v)}`, "BAD_VALUE");
    return String(Math.round(n));
  };
  const list = (v: unknown): string => {
    if (v === "" || v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return "";
    const arr = Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : String(v).split(/[\n,]+/);
    return JSON.stringify([...new Set(arr.map((x) => x.trim()).filter(Boolean))]);
  };

  const updates: { key: string; value: string }[] = [];
  if (regions) updates.push({ key: "odds.regions", value: regions });
  if (body.rateLimitMs !== undefined) updates.push({ key: "odds.rateLimitMs", value: num(body.rateLimitMs, 50) });
  if (body.eventBookmakers !== undefined) updates.push({ key: "odds.eventBookmakers", value: String(body.eventBookmakers).trim() || "" });
  if (body.markets !== undefined) updates.push({ key: "odds.markets", value: list(body.markets) });
  if (body.feedMaxLeagues !== undefined) updates.push({ key: "odds.feedMaxLeagues", value: num(body.feedMaxLeagues, 1) });
  if (body.eventMarketLimit !== undefined) updates.push({ key: "odds.eventMarketLimit", value: num(body.eventMarketLimit, 0) });
  if (body.eventMarketLeagues !== undefined) updates.push({ key: "odds.eventMarketLeagues", value: list(body.eventMarketLeagues) });

  for (const u of updates) await setSetting(u.key, u.value);
  invalidateSettingsCache();
  revalidatePath("/", "layout");
  return ok({ saved: updates.map((u) => u.key), message: "Odds engine settings saved — apply on the next sync run." });
});
