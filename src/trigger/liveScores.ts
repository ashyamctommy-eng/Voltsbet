import { schedules, logger } from "@trigger.dev/sdk/v3";
import { refreshLiveScores } from "@/lib/live-scores";

/**
 * Live score synchronization — runs every 2 minutes on Trigger.dev.
 *
 * Rather than re-implementing fetch/DB logic (the API has no
 * /sports/upcoming/scores endpoint — scores are per-league:
 * /v4/sports/{sportKey}/scores?daysFrom=1), this task drives the SAME engine
 * the app already uses, so it inherits:
 *   - league resolution from DB candidates (LEAGUE_TITLES reverse map),
 *   - the league-sync whitelist + regions settings,
 *   - throttling/backoff (credits) and cross-process coordination,
 *   - score + in-play odds upserts, and
 *   - orphan cleanup: deletes seed rows stuck LIVE and force-finishes stale
 *     API live rows older than LIVE_STALE_FINISH_HOURS (default 4h).
 *
 * Manual trigger: POST /api/admin/trigger-sync →
 * tasks.trigger("sync-live-scores").
 */
export const liveScoresSync = schedules.task({
  id: "sync-live-scores",
  cron: "*/2 * * * *",
  maxDuration: 60,
  run: async () => {
    const result = await refreshLiveScores();

    if (result.skipped) {
      // Another sweep (a /live visitor, or a previous run) is inside the
      // throttle window — expected most of the time, not an error.
      logger.info("live-scores: skipped (throttled)", { leagues: result.leagues });
      return result;
    }

    logger.info("live-scores: sweep complete", {
      updated: result.updated,
      created: result.created,
      oddsUpdated: result.oddsUpdated,
      leagues: result.leagues.length,
      orphanDeleted: result.orphanDeleted ?? 0,
      staleFinished: result.staleFinished ?? 0,
      stuckManual: result.stuckManual ?? 0,
    });
    return result;
  },
});
