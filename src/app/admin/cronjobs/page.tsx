import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { CRON_JOBS } from "@/lib/cron-jobs";
import CronJobsAdmin from "@/components/admin/CronJobsAdmin";
import TriggerActions from "@/components/admin/TriggerActions";

export const dynamic = "force-dynamic";

export default async function CronJobsPage() {
  const s = await getSettings();
  const baseUrl = s.appUrl || process.env.APP_URL || "";
  const secret = s.cronSecret || process.env.CRON_SECRET || "";

  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "cron.jobs." } } });
  const schedules: Record<string, string> = {};
  for (const r of rows) schedules[r.key.replace("cron.jobs.", "")] = r.value;

  // Odds freshness — written by every successful pre-match sync.
  const [lastSyncAt, lastSyncStats] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "odds.lastSyncAt" } }),
    prisma.setting.findUnique({ where: { key: "odds.lastSyncStats" } }),
  ]);
  const syncedAt = lastSyncAt ? new Date(lastSyncAt.value) : null;
  // Server component, force-dynamic — "now" is request-scoped, not render state.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const ageHours = syncedAt ? (now - syncedAt.getTime()) / 3600_000 : null;
  const stats = (() => {
    try {
      return lastSyncStats ? (JSON.parse(lastSyncStats.value) as { mode?: string; leagues?: number; created?: number; updated?: number; games?: number }) : null;
    } catch {
      return null;
    }
  })();
  const stale = ageHours === null || ageHours > 26; // >26h = missed a 12h cycle + margin
  // Defaults for any job without a saved override.
  for (const j of CRON_JOBS) if (!schedules[j.id]) schedules[j.id] = j.defaultSchedule;

  return (
    <div>
      <h2 className="text-xl font-extrabold">Cron Settings</h2>
      <div
        className={`mt-3 rounded-xl border p-3 text-xs ${
          stale ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
        }`}
      >
        {syncedAt ? (
          <>
            <b>Odds last synced {ageHours! < 1 ? "under an hour" : `${Math.floor(ageHours!)}h`} ago</b>
            {stats && (
              <span className="ml-2 text-ink2">
                ({stats.mode} · {stats.leagues} leagues · {stats.created} created / {stats.updated} updated · {stats.games} fixtures)
              </span>
            )}
            {stale && <div className="mt-1 text-amber-700 dark:text-amber-300">No sync in &gt;26h — check the Trigger.dev “sync-odds” task / ODDS_API_KEY.</div>}
          </>
        ) : (
          <b>No odds sync recorded yet — run “Sync odds” below (or wait for the schedule).</b>
        )}
      </div>
      <div className="mt-3">
        <TriggerActions />
      </div>
      <p className="mt-1 text-sm text-ink3">
        The four scheduled jobs behind {s.siteName}. Trigger them from any scheduler — Railway Cron, UptimeRobot,
        cron-job.org, or your own webhook/CI — ready-to-paste configs for each provider are generated per job below.
        Schedules are evaluated in UTC.
      </p>
      <div className="mt-4">
        <CronJobsAdmin baseUrl={baseUrl} secret={secret} initialSchedules={schedules} />
      </div>
    </div>
  );
}
