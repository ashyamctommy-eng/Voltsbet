import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { checkCronSecret } from "@/lib/cron-guard";
import { clearPrematchFeedCache } from "@/lib/feed";
import { invalidateSettingsCache } from "@/lib/settings";

/**
 * Cron cache-bust endpoint — drops the in-process homepage feed cache and the
 * settings cache so freshly synced odds/settings are visible immediately.
 *
 * Called by the Trigger.dev "sync-odds" task after a successful sync
 * (set APP_URL + CRON_SECRET in the Trigger.dev environment). Safe to call
 * manually:  POST /api/cron/refresh?secret=<cron.secret>
 */
export const POST = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  clearPrematchFeedCache();
  invalidateSettingsCache();
  return ok({ refreshed: true, message: "Feed + settings caches cleared." });
});

export const GET = POST;
