import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { setSetting } from "@/lib/settings";
import { CRON_JOB_IDS, CRON_JOBS, scheduleSettingKey, type CronJobId } from "@/lib/cron-jobs";

/** GET — effective schedules (saved overrides + defaults) for the admin page. */
export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "cron.jobs." } } });
  const saved: Record<string, string> = {};
  for (const r of rows) saved[r.key.replace("cron.jobs.", "")] = r.value;
  const jobs = CRON_JOBS.map((j) => ({ id: j.id, schedule: saved[j.id] ?? j.defaultSchedule, saved: !!saved[j.id] }));
  return ok({ jobs, saved });
});

/** POST — save schedule overrides for one or more jobs. */
export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "settings");
  const body = (await req.json().catch(() => null)) as { jobs?: Record<string, string> } | null;
  const jobs = body?.jobs;
  if (!jobs || typeof jobs !== "object") throw new ApiError(400, "Missing jobs map.", "VALIDATION");

  const saved: string[] = [];
  for (const [id, schedule] of Object.entries(jobs)) {
    if (!CRON_JOB_IDS.includes(id as CronJobId)) throw new ApiError(400, `Unknown job: ${id}`, "VALIDATION");
    const expr = String(schedule ?? "").trim();
    if (!expr || expr.length > 100) throw new ApiError(400, `Invalid schedule for ${id}.`, "VALIDATION");
    // Loose cron validation — 5 or 6 space-separated fields of digits/*/,-.
    const fields = expr.split(/\s+/);
    if (fields.length < 5 || fields.length > 6) throw new ApiError(400, `Invalid cron expression: ${expr}`, "VALIDATION");
    await setSetting(scheduleSettingKey(id as CronJobId), expr);
    saved.push(id);
  }
  await auditLog({ admin, action: "UPDATE", entity: "SETTING", entityId: "cron.jobs" });
  return ok({ saved });
});
