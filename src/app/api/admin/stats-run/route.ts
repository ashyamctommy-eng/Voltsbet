import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { runStatsSettlement } from "@/lib/stats/settle-stats";

/**
 * "Run settlement now" — Admin → API Settings → Settlement stats feed.
 *
 * Forces one stats pass (bypassing the 10-minute throttle) so an admin can
 * settle a just-finished match without waiting for the cron. Same guard rails as
 * the scheduled pass: provider + toggles must be on, the daily budget applies,
 * and undecidable outcomes stay in the review queue. Costs at most
 * (1 fixture list + 1 statistics call) per match that actually needs data —
 * everything is cached afterwards.
 */
export const POST = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "odds"); // same resource as the API Settings card
  const result = await runStatsSettlement({ force: true });
  return ok(result);
});
