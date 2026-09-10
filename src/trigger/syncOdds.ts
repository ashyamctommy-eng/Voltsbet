import { schedules, logger } from "@trigger.dev/sdk/v3";
import { syncGames } from "@/lib/sync";

/**
 * Pre-match odds sync — the job that makes fixture odds "move daily".
 *
 * Runs the same engine as /api/cron/sync's odds pass (league whitelist,
 * regions/markets settings, margin application, derived markets). The cadence
 * here is what defines how fresh pre-match prices are: every 12h by default.
 *
 * Credit note: each run costs ~1 request per whitelisted league per market
 * region (e.g. 48 leagues @ eu = 144 credits). Tune the cron and/or the
 * league whitelist (Admin → API Settings) to fit your plan.
 *
 * After syncing, it pings the app's /api/cron/refresh (protected by
 * CRON_SECRET) so the in-memory homepage feed cache is dropped and new odds
 * are visible immediately instead of after its TTL.
 */
export const syncOdds = schedules.task({
  id: "sync-odds",
  cron: "0 */12 * * *", // every 12h — tighten to e.g. "0 */6 * * *" on a bigger plan
  maxDuration: 60,
  run: async () => {
    const result = await syncGames();
    logger.info("sync-odds: complete", result);

    // Best-effort cache bust on the web app (optional: set APP_URL + CRON_SECRET
    // in the Trigger.dev environment).
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.CRON_SECRET;
    if (appUrl && secret) {
      try {
        const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/cron/refresh?secret=${encodeURIComponent(secret)}`, {
          method: "POST",
        });
        logger.info("sync-odds: cache refresh ping", { status: res.status });
      } catch (e) {
        logger.warn("sync-odds: cache refresh ping failed (non-fatal)", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return result;
  },
});
