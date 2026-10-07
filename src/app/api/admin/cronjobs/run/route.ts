import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { CRON_JOB_IDS, type CronJobId } from "@/lib/cron-jobs";
import { syncGames } from "@/lib/sync";
import { syncWeeklyFixtures, purgeExpiredFixtures } from "@/lib/schedule-sync";
import { autoSettleFinishedGames } from "@/lib/auto-settle";
import { reconcilePendingPayments } from "@/lib/payment-reconcile";

/** POST /api/admin/cronjobs/run — run a cron job right now (admin auth,
 *  no CRON_SECRET needed). */
export const POST = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const body = (await req.json().catch(() => null)) as { job?: string } | null;
  const job = body?.job;
  if (!job || !CRON_JOB_IDS.includes(job as CronJobId)) {
    throw new ApiError(400, `Unknown job: ${job}`, "VALIDATION");
  }
  const at = new Date().toISOString();
  switch (job as CronJobId) {
    case "sync":
      try {
        return ok({ job, at, ...(await syncGames()) });
      } catch (e) {
        // Admin-only surface: expose the specific upstream reason (e.g. a 401
        // invalid/expired key) rather than the generic 500 handler's message.
        const reason = e instanceof Error ? e.message : String(e);
        console.error(`[admin/cronjobs/run] sync failed: ${reason}`);
        throw new ApiError(502, `Odds sync failed: ${reason}`, "SYNC_FAILED");
      }
    case "schedule":
      return ok({ job, at, ...(await syncWeeklyFixtures()) });
    case "settle":
      return ok({ job, at, ...(await autoSettleFinishedGames()) });
    case "purge":
      return ok({ job, at, ...(await purgeExpiredFixtures()) });
    case "reconcile":
      return ok({ job, at, ...(await reconcilePendingPayments()) });
  }
});
