import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard, auditLog } from "@/lib/api";

/**
 * POST /api/admin/trigger-sync — force-run a Trigger.dev task outside its
 * schedule. Body (optional): { task: "live" | "odds" | "settle" | "purge" | "calendar" }
 * Defaults to "live" (live-score sync).
 *
 * Auth: admin (settings resource) + CSRF (sharedAdminGuard).
 * Requires TRIGGER_SECRET_KEY on the server (Trigger.dev → Project → API keys).
 * The task itself runs in Trigger.dev with its own env (DATABASE_URL, ODDS_API_KEY).
 */
export const dynamic = "force-dynamic";

const TASK_IDS: Record<string, string> = {
  live: "sync-live-scores",
  odds: "sync-odds",
  settle: "settle-games",
  purge: "purge-expired",
  calendar: "refresh-calendar",
};

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "settings");

  const body = (await req.json().catch(() => null)) as { task?: string } | null;
  const key = (body?.task ?? "live").toLowerCase();
  const taskId = TASK_IDS[key];
  if (!taskId) {
    throw new ApiError(400, `Unknown task "${key}". Use one of: ${Object.keys(TASK_IDS).join(", ")}`, "BAD_TASK");
  }

  if (!process.env.TRIGGER_SECRET_KEY) {
    throw new ApiError(
      503,
      "Trigger.dev is not configured — set TRIGGER_SECRET_KEY in the server environment.",
      "TRIGGER_UNCONFIGURED",
    );
  }

  try {
    const { tasks } = await import("@trigger.dev/sdk/v3");
    const run = await tasks.trigger(taskId, {});
    await auditLog({
      admin,
      action: "TRIGGER",
      entity: "BACKGROUND_JOB",
      entityId: run.id,
      newValue: { task: taskId, runId: run.id },
    });
    return ok({
      runId: run.id,
      task: taskId,
      message: `${key} task triggered on Trigger.dev.`,
    });
  } catch (e) {
    throw new ApiError(
      502,
      `Trigger.dev trigger failed: ${e instanceof Error ? e.message : String(e)}`,
      "TRIGGER_FAILED",
    );
  }
});
