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
import { handle, ok } from "@/lib/api";
import { checkCronSecret, makeCronJob } from "@/lib/cron-guard";
import { syncWeeklyFixtures } from "@/lib/schedule-sync";

const job = makeCronJob(Number(process.env.SCHEDULE_THROTTLE_MINUTES) || 60);

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  const { result, throttled, coalesced, retryInSeconds } = await job.run(syncWeeklyFixtures);
  return ok({
    ...result,
    at: new Date().toISOString(),
    ...(throttled ? { throttled: true, retryInSeconds } : {}),
    ...(coalesced ? { coalesced: true } : {}),
  });
});

export const POST = GET;
