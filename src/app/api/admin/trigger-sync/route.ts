import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard, auditLog } from "@/lib/api";

/**
 * POST /api/admin/trigger-sync — force-run the Trigger.dev live-score sync
 * task ("sync-live-scores") outside its 2-minute schedule.
 *
 * Auth: admin (settings resource) + CSRF (sharedAdminGuard).
 * Requires TRIGGER_SECRET_KEY on the server (Trigger.dev → Project → API keys).
 * The task itself runs in Trigger.dev with its own env (DATABASE_URL, ODDS_API_KEY).
 */
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "settings");

  if (!process.env.TRIGGER_SECRET_KEY) {
    throw new ApiError(
      503,
      "Trigger.dev is not configured — set TRIGGER_SECRET_KEY in the server environment.",
      "TRIGGER_UNCONFIGURED",
    );
  }

  try {
    const { tasks } = await import("@trigger.dev/sdk/v3");
    const run = await tasks.trigger("sync-live-scores", {});
    await auditLog({
      admin,
      action: "TRIGGER",
      entity: "LIVE_SYNC",
      entityId: run.id,
      newValue: { task: "sync-live-scores", runId: run.id },
    });
    return ok({
      runId: run.id,
      message: "Live score sync triggered on Trigger.dev.",
    });
  } catch (e) {
    throw new ApiError(
      502,
      `Trigger.dev trigger failed: ${e instanceof Error ? e.message : String(e)}`,
      "TRIGGER_FAILED",
    );
  }
});
