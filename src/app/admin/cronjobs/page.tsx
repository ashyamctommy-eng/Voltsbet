import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { CRON_JOBS } from "@/lib/cron-jobs";
import CronJobsAdmin from "@/components/admin/CronJobsAdmin";

export const dynamic = "force-dynamic";

export default async function CronJobsPage() {
  const s = await getSettings();
  const baseUrl = s.appUrl || process.env.APP_URL || "";
  const secret = s.cronSecret || process.env.CRON_SECRET || "";

  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "cron.jobs." } } });
  const schedules: Record<string, string> = {};
  for (const r of rows) schedules[r.key.replace("cron.jobs.", "")] = r.value;
  // Defaults for any job without a saved override.
  for (const j of CRON_JOBS) if (!schedules[j.id]) schedules[j.id] = j.defaultSchedule;

  return (
    <div>
      <h2 className="text-xl font-extrabold">Cronjobs</h2>
      <p className="mt-1 text-sm text-ink3">
        The four scheduled jobs behind VoltBet — with ready-to-paste configs for cron-job.org (recommended), UptimeRobot,
        Railway cron, or plain curl. Schedules are evaluated in UTC.
      </p>
      <div className="mt-4">
        <CronJobsAdmin baseUrl={baseUrl} secret={secret} initialSchedules={schedules} />
      </div>
    </div>
  );
}
