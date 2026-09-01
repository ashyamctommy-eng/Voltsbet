import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";

/**
 * Admin API config — The Odds API (v4) — the ONLY sports data provider.
 *
 * Credentials live in the ODDS_API_KEY environment variable (never in the
 * DB); this endpoint reports configuration status + quota headers. The old
 * BetsAPI (RapidAPI) live engine and per-provider role switches were
 * removed — pre-match AND live both run on The Odds API now.
 *
 * GET /api/admin/config/api → current provider status (key set, regions)
 */
export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const key = process.env.ODDS_API_KEY ?? "";
  return ok({
    config: {
      provider: "the-odds-api",
      keySet: !!key,
      keyMasked: key ? "••••" + key.slice(-4) : "",
      regions: process.env.ODDS_API_REGIONS ?? "us",
      note: "Sports data is served exclusively by The Odds API (v4) — set ODDS_API_KEY in the server environment.",
    },
  });
});
