import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { getSettings, setSetting, invalidateSettingsCache } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { estimateSyncCostWithMarkets } from "@/lib/odds-cost";

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
 *
 * Live scores & in-play odds (Admin → API Settings → Live scores):
 *   live.refreshSeconds          /live page auto-refresh poll (seconds)
 *   live.scoresThrottleSeconds   min s between /scores sweeps
 *   live.lookbackHours           kickoff lookback window for candidates
 *   live.oddsThrottleSeconds     min s between in-play odds refreshes
 *   live.oddsMarkets             in-play market keys (default h2h)
 */
let quotaCache: { at: number; used: number; remaining: number } | null = null;
const QUOTA_TTL_MS = 60_000;

/** Quota snapshot captured from the last live sweep's response headers
 *  (Setting `odds.lastQuota`, written by live-scores). Fresher than the
 *  /sports probe when the sweep ran more recently. */
async function fetchSweepQuota(): Promise<{ remaining: number | null; used: number | null; cost: number | null; at: string; path?: string } | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "odds.lastQuota" } });
    if (!row?.value) return null;
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

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
  const [quota, lastSweep] = await Promise.all([fetchQuota(), fetchSweepQuota()]);

  // Estimated cost of ONE sync under the CURRENT config — so the admin sees the
  // burn before pressing anything. Leagues = whitelist length if set, else the
  // catalog cap (the no-whitelist path walks up to that many leagues).
  const estimateLeagues = (s.oddsSyncLeagues?.length ?? 0) || s.oddsFeedMaxLeagues;
  const costEstimate = await estimateSyncCostWithMarkets({
    leagues: estimateLeagues,
    regions: s.oddsRegions,
    eventLeagues: (s.oddsEventMarketLeagues ?? []).length,
    eventLimit: s.oddsEventMarketLimit,
  }).catch(() => null);
  const creditCap = Number(process.env.MAX_CREDITS_PER_RUN);

  const env = {
    regions: process.env.ODDS_API_REGIONS,
    rateLimitMs: process.env.ODDS_API_RATE_LIMIT_MS,
    eventBookmakers: process.env.ODDS_API_EVENT_BOOKMAKERS,
    markets: process.env.ODDS_API_MARKETS,
    feedMaxLeagues: process.env.ODDS_API_FEED_MAX_LEAGUES,
    eventMarketLimit: process.env.ODDS_API_EVENT_MARKET_LIMIT,
    eventMarketLeagues: process.env.ODDS_API_EVENT_MARKET_LEAGUES,
    liveScoresThrottleSeconds: process.env.LIVE_SCORES_THROTTLE_SECONDS,
    liveLookbackHours: process.env.LIVE_SCORES_LOOKBACK_HOURS,
    liveOddsThrottleSeconds: process.env.LIVE_ODDS_THROTTLE_SECONDS,
    liveOddsMarkets: process.env.ODDS_API_LIVE_MARKETS,
    detailMarkets: process.env.SOCCER_DETAIL_MARKETS,
    detailCacheTtlSeconds: process.env.SOCCER_DETAIL_CACHE_TTL_SECONDS,
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
      liveRefreshSeconds: s.liveRefreshSeconds,
      liveScoresThrottleSeconds: s.liveScoresThrottleSeconds,
      liveLookbackHours: s.liveLookbackHours,
      liveOddsThrottleSeconds: s.liveOddsThrottleSeconds,
      liveOddsMarkets: s.liveOddsMarkets,
      detailMarkets: s.soccerDetailMarkets,
      detailCacheTtlSeconds: s.soccerDetailCacheTtlSeconds,
    },
    env,
    quota,
    lastSweep,
    costEstimate,
    creditCap: Number.isFinite(creditCap) && creditCap > 0 ? creditCap : null,
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
  // Live scores & in-play odds knobs
  if (body.liveRefreshSeconds !== undefined) updates.push({ key: "live.refreshSeconds", value: num(body.liveRefreshSeconds, 10) });
  if (body.liveScoresThrottleSeconds !== undefined) updates.push({ key: "live.scoresThrottleSeconds", value: num(body.liveScoresThrottleSeconds, 10) });
  if (body.liveLookbackHours !== undefined) updates.push({ key: "live.lookbackHours", value: num(body.liveLookbackHours, 1) });
  if (body.liveOddsThrottleSeconds !== undefined) updates.push({ key: "live.oddsThrottleSeconds", value: num(body.liveOddsThrottleSeconds, 10) });
  if (body.liveOddsMarkets !== undefined) updates.push({ key: "live.oddsMarkets", value: list(body.liveOddsMarkets) });

  // TIER 2 — match-detail deep markets + cache TTL
  if (body.detailMarkets !== undefined) updates.push({ key: "soccer.detailMarkets", value: list(body.detailMarkets) });
  if (body.detailCacheTtlSeconds !== undefined) updates.push({ key: "soccer.detailCacheTtlSeconds", value: num(body.detailCacheTtlSeconds, 5) });

  for (const u of updates) await setSetting(u.key, u.value);
  invalidateSettingsCache();
  revalidatePath("/", "layout");
  return ok({ saved: updates.map((u) => u.key), message: "Odds engine settings saved — apply on the next sync run." });
});
