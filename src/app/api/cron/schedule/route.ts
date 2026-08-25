/**
 * Cron endpoint — rolling 7-day fixture schedule sync (The Odds API /events,
 * 0 quota cost).
 *
 * Refreshes the local `Game` calendar for [today, today+7] so date-filtered
 * views (/api/matches) are served from the DB. Run daily (e.g. Railway cron
 * `0 3 * * *`). Prices come from the Odds API odds sync (/api/cron/sync);
 * this endpoint fills the calendar only, including games not yet priced.
 *
 *   GET https://your-app/api/cron/schedule?secret=<cron.secret>
 */
import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { syncWeeklyFixtures } from "@/lib/schedule-sync";

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
  const result = await syncWeeklyFixtures();
  return ok({ ...result, at: new Date().toISOString() });
});

export const POST = GET;
