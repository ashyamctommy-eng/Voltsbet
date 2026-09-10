import { schedules, logger } from "@trigger.dev/sdk/v3";
import { autoSettleFinishedGames } from "@/lib/auto-settle";
import { purgeExpiredFixtures, syncWeeklyFixtures } from "@/lib/schedule-sync";
import { expireStaleDeposits } from "@/lib/deposits";

/** Settle finished games — every 10 minutes (free, no API credits). */
export const settleGames = schedules.task({
  id: "settle-games",
  cron: "*/10 * * * *",
  maxDuration: 120,
  run: async () => {
    const result = await autoSettleFinishedGames();
    logger.info("settle-games: complete", result);
    return result;
  },
});

/**
 * Refresh the rolling 7-day calendar from the FREE /events endpoint —
 * daily 05:30 UTC. 0 API credits.
 */
export const refreshCalendar = schedules.task({
  id: "refresh-calendar",
  cron: "30 5 * * *",
  maxDuration: 120,
  run: async () => {
    const result = await syncWeeklyFixtures();
    logger.info("refresh-calendar: complete", result);
    return result;
  },
});

/**
 * Purge expired rows (games kicked off >2h ago, not in play, no bets) and
 * expire abandoned deposit windows — daily 00:30 UTC.
 */
export const purgeExpired = schedules.task({
  id: "purge-expired",
  cron: "30 0 * * *",
  maxDuration: 120,
  run: async () => {
    const [purge, deposits] = await Promise.all([purgeExpiredFixtures(), expireStaleDeposits()]);
    logger.info("purge-expired: complete", { ...purge, deposits });
    return { ...purge, deposits };
  },
});
