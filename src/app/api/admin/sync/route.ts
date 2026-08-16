import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf } from "@/lib/api";
import { syncGames } from "@/lib/sync";

/** POST /api/admin/sync — trigger an on-demand sports-data sync. */
export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  await requireAdmin("games");
  const result = await syncGames();
  return ok(result);
});
