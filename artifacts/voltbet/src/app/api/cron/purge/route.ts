/**
 * Cron endpoint — expired fixture purge (daily midnight job).
 *
 * Deletes games that started more than PURGE_MAX_AGE_HOURS (default 2) ago
 * and are not in play; Market/Outcome rows cascade with them. Also expires
 * stale pending deposits so abandoned payment windows surface in the admin
 * panel instead of lingering forever. Equivalent to:
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
import { handle, ok } from "@/lib/api";
import { checkCronSecret, makeCronJob } from "@/lib/cron-guard";
import { purgeExpiredFixtures } from "@/lib/schedule-sync";
import { expireStaleDeposits } from "@/lib/deposits";

const job = makeCronJob(Number(process.env.PURGE_THROTTLE_MINUTES) || 60);

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  const { result, throttled, coalesced, retryInSeconds } = await job.run(async () => {
    const [purge, expired] = await Promise.all([purgeExpiredFixtures(), expireStaleDeposits()]);
    return { ...purge, depositsExpired: expired };
  });
  return ok({
    ok: true,
    ...result,
    at: new Date().toISOString(),
    ...(throttled ? { throttled: true, retryInSeconds } : {}),
    ...(coalesced ? { coalesced: true } : {}),
  });
});

export const POST = GET;
