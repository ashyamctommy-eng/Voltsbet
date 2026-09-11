import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { checkCronSecret, makeCronJob } from "@/lib/cron-guard";
import { autoSettleFinishedGames } from "@/lib/auto-settle";
import { runStatsSettlement } from "@/lib/stats/settle-stats";

/**
 * Cron endpoint — settle finished games automatically.
 *
 * Protect with the cron secret (Admin → Website Settings → Automation, or the
 * CRON_SECRET env var as fallback). Call from any scheduler, e.g. every 10 min:
 *
 *   cron-job.org / Railway cron / GitHub Actions:
 *     GET https://your-app/api/cron/settle?secret=<cron.secret>
 *
 * Responds 200 with counts; 401 without the secret; 503 if unconfigured.
 * Throttled/coalesced per process so overlapping triggers never run the
 * settlement sweep twice concurrently.
 */
const job = makeCronJob(Number(process.env.SETTLE_THROTTLE_MINUTES) || 5);

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);

  /**
   * Order matters: the stats pass ENRICHES the data (half-time scores, corner
   * counts) first, then the score-based sweep settles everything that now has a
   * determinate result. `?forceStats=1` bypasses the stats pass throttle so an
   * admin can check a just-finished match immediately.
   */
  const forceStats = req.nextUrl.searchParams.get("forceStats") === "1";
  const { result, throttled, coalesced, retryInSeconds } = await job.run(async () => {
    const stats = await runStatsSettlement({ force: forceStats });
    const settle = await autoSettleFinishedGames();
    return { ...settle, stats };
  });

  return ok({
    ...result,
    ...(throttled ? { throttled: true, retryInSeconds } : {}),
    ...(coalesced ? { coalesced: true } : {}),
  });
});

export const POST = GET;
