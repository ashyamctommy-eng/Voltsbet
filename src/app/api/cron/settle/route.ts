import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { autoSettleFinishedGames } from "@/lib/auto-settle";

/**
 * Cron endpoint — settle finished games automatically.
 *
 * Protect with the cron secret (Admin → Website Settings → Automation, or the
 * CRON_SECRET env var as fallback). Call from any scheduler, e.g. every 10 min:
 *
 *   cron-job.org / Railway cron / GitHub Actions:
 *     GET https://your-app/api/cron/settle?secret=<cron.secret>
 *
 * Responds 200 with counts; 401 without the secret; 503 if unconfigured.
 */
export const GET = handle(async (req: NextRequest) => {
  const settings = await getSettings();
  const secret = settings.cronSecret || process.env.CRON_SECRET || "";
  if (!secret) {
    throw new ApiError(503, "Cron secret not configured — set cron.secret in admin settings.", "CRON_NOT_CONFIGURED");
  }
  const provided = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? "";
  if (provided !== secret) {
    throw new ApiError(401, "Invalid cron secret.", "UNAUTHORIZED");
  }
  const result = await autoSettleFinishedGames();
  return ok(result);
});

export const POST = GET;
