/**
 * Cron job catalog — single source of truth for the Admin → Cronjobs page.
 * The same 4 endpoints are used by any scheduler (Railway cron, cron-job.org,
 * UptimeRobot, GitHub Actions); this module feeds the UI + generated configs.
 */

export type CronJobId = "sync" | "schedule" | "settle" | "purge";

export type CronJobDef = {
  id: CronJobId;
  title: string;
  short: string; // one-line purpose
  description: string;
  defaultSchedule: string; // recommended cron expression (UTC)
  credits: string; // Odds API credit cost per run
  uptimerobotInterval: string; // free-plan interval choice
};

export const CRON_JOBS: CronJobDef[] = [
  {
    id: "sync",
    title: "Sync odds prices",
    short: "Pulls pre-match odds from The Odds API for all in-season leagues.",
    description:
      "The only job that costs Odds API credits (~44/run). Free key = 500/mo ≈ 11 runs → every 3 days. After the paid plan: 3–4×/day.",
    defaultSchedule: "0 6 */3 * *",
    credits: "~44",
    uptimerobotInterval: "24 hours",
  },
  {
    id: "schedule",
    title: "Refresh 7-day calendar",
    short: "Fills the rolling [today, +7] fixture calendar via the FREE /events endpoint.",
    description: "0 quota cost. Run daily so date-filtered views (/api/matches) are always served from the DB.",
    defaultSchedule: "0 5 * * *",
    credits: "0",
    uptimerobotInterval: "24 hours",
  },
  {
    id: "settle",
    title: "Settle finished games",
    short: "Auto-settles finished games (win / void / loss) so results land quickly.",
    description: "0 quota cost. Frequency matters: run every 10–15 min so settlements don't lag behind match end.",
    defaultSchedule: "*/12 * * * *",
    credits: "0",
    uptimerobotInterval: "5 minutes",
  },
  {
    id: "purge",
    title: "Purge expired rows",
    short: "Deletes calendar rows kicked off >2h ago that aren't in play.",
    description: "0 quota cost. Never deletes games with bet history (results survive). Markets cascade automatically.",
    defaultSchedule: "0 0 * * *",
    credits: "0",
    uptimerobotInterval: "24 hours",
  },
];

export const SCHEDULE_SETTING_PREFIX = "cron.jobs.";

/** Setting key used to persist a job's custom schedule: cron.jobs.<id> */
export function scheduleSettingKey(id: CronJobId): string {
  return `${SCHEDULE_SETTING_PREFIX}${id}`;
}

/** Resolve a job's effective schedule (saved override ?? recommended default). */
export function effectiveSchedule(id: CronJobId, saved: Record<string, string> | undefined): string {
  const def = CRON_JOBS.find((j) => j.id === id);
  return saved?.[id] ?? def?.defaultSchedule ?? "";
}

export const CRON_JOB_IDS = CRON_JOBS.map((j) => j.id) as CronJobId[];
