import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { syncGames } from "@/lib/sync";
import { refreshLiveScores } from "@/lib/live-scores";
import { clearPrematchFeedCache } from "@/lib/feed";

/**
 * Cron endpoint — automated pre-match sync + live-score refresh.
 *
 * Runs the configured sync provider (the-odds-api / api-football) to refresh
 * fixtures + odds in the DB, then pulls fresh in-play scores (BetsAPI live
 * engine, throttled). The homepage feed reads the API directly (no sync
 * needed to display); this keeps the DB fresh for /live, fixture pages,
 * settlement and the admin Games page.
 *
 * Budget (The Odds API free tier, 500 req/month): a full sync is ~1 request
 * per league per market set (default 4 soccer leagues + NBA ≈ 10 requests).
 * Schedule 2–4×/day (≈ 20–40 requests/month) — NOT every few minutes.
 *
 * Protect with the cron secret (Admin → Website Settings → Automation, or
 * CRON_SECRET env). Call from any scheduler, e.g.:
 *
 *   GET https://your-app/api/cron/sync?secret=<cron.secret>
 *
 * 200 with counts · 401 without the secret · 503 if unconfigured.
 */
export const GET = handle(async (req: NextRequest) => {
  const settings = await getSettings();
  const secret = settings.cronSecret || process.env.CRON_SECRET || "";
  if (!secret) {
    throw new ApiError(503, "Cron secret not configured — set cron.secret in admin settings.", "CRON_NOT_CONFIGURED");
  }
  const provided = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? "";
  if (provided !== secret) {
    throw new ApiError(401, "Invalid cron secret.", "UNAUTHORIZED");
  }

  const [sync, live] = await Promise.allSettled([
    syncGames(),
    refreshLiveScores(),
  ]);

  const syncResult = sync.status === "fulfilled" ? sync.value : { error: sync.reason instanceof Error ? sync.reason.message : String(sync.reason) };
  const liveResult = live.status === "fulfilled" ? live.value : { error: live.reason instanceof Error ? live.reason.message : String(live.reason) };

  clearPrematchFeedCache();
  return ok({ synced: syncResult, live: liveResult, at: new Date().toISOString() });
});

export const POST = GET;
