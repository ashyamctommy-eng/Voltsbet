/**
 * Cron endpoint — expired fixture purge (daily midnight job).
 *
 * Deletes games that started more than PURGE_MAX_AGE_HOURS (default 2) ago
 * and are not in play; Market/Outcome rows cascade with them. Equivalent to:
 *
 *   DELETE FROM "Game"
 *   WHERE "startAt" < NOW() - INTERVAL '2 hours'
 *     AND status NOT IN ('LIVE','HALF_TIME');
 *
 * Schedule via Railway Cron `0 0 * * *` (midnight). NOTE: settlement
 * (/api/cron/settle) runs every 10–15 min, so finished games are settled
 * well before the 2h mark — keep that cadence so the purge never removes
 * unsettled results.
 *
 *   GET https://your-app/api/cron/purge?secret=<cron.secret>
 */
import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { purgeExpiredFixtures } from "@/lib/schedule-sync";

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
  const result = await purgeExpiredFixtures();
  return ok({ ok: true, ...result, at: new Date().toISOString() });
});

export const POST = GET;
