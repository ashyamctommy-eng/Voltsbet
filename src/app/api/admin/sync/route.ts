import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { syncGames } from "@/lib/sync";

/** POST /api/admin/sync — trigger an on-demand sports-data sync. */
export const POST = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "games");
  try {
    const result = await syncGames();
    return ok(result);
  } catch (e) {
    // Admin-only surface: surface the real cause (the generic handler would
    // hide it behind "Something went wrong"). The sync engine fault-isolates
    // per league/event, so reaching this catch means the whole pipeline died.
    throw new ApiError(
      502,
      `Sync failed: ${e instanceof Error ? e.message : String(e)}`,
      "SYNC_FAILED"
    );
  }
});
