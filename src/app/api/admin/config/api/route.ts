import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf } from "@/lib/api";
import { getSettings, setSetting } from "@/lib/settings";
import { clearPrematchFeedCache } from "@/lib/feed";

/**
 * Admin API config — BetsAPI (bet365 via RapidAPI) LIVE engine credentials.
 *
 * BetsAPI powers the /live in-play surface (refreshLiveScores + the live
 * proxy). Pre-match odds come from the sync providers (the-odds-api /
 * api-football — see Admin → Settings → Odds & Risk). This page no longer
 * switches the pre-match provider; role overrides are still honored there.
 *
 * GET  /api/admin/config/api      → current config (key masked)
 * POST /api/admin/config/api      → persist creds + optional provider roles
 */
export const GET = handle(async () => {
  const admin = await requireAdmin("settings");
  const s = await getSettings();
  void admin;
  return ok({
    config: {
      rapidKey: s.apiRapidKey ? "••••••••" + s.apiRapidKey.slice(-4) : "",
      rapidKeySet: !!s.apiRapidKey,
      rapidHost: s.apiRapidHost,
      rapidBase: s.apiRapidBase,
      primaryProvider: s.oddsProvider,
      prematchProvider: s.oddsPrematchProvider,
      liveProvider: s.oddsLiveProvider,
    },
  });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  await requireAdmin("settings");
  const body = await req.json().catch(() => null);
  const s = await getSettings();

  const rapidKey = typeof body?.rapidKey === "string" && body.rapidKey.trim()
    ? body.rapidKey.trim()
    : s.apiRapidKey; // keep existing when left blank
  const rapidHost =
    typeof body?.rapidHost === "string" && body.rapidHost.trim()
      ? body.rapidHost.trim()
      : s.apiRapidHost || "betsapi2.p.rapidapi.com";
  const rapidBase =
    typeof body?.rapidBase === "string" && body.rapidBase.trim()
      ? body.rapidBase.trim().replace(/\/+$/, "")
      : s.apiRapidBase || "https://betsapi2.p.rapidapi.com";

  await setSetting("api.rapidKey", rapidKey);
  await setSetting("api.rapidHost", rapidHost);
  await setSetting("api.rapidBase", rapidBase);

  // Per-provider roles (pre-match source / live source) — empty = follow primary.
  const VALID_PROVIDERS = new Set(["the-odds-api", "api-football"]);
  if (typeof body?.prematchProvider === "string" && VALID_PROVIDERS.has(body.prematchProvider)) {
    await setSetting("odds.prematchProvider", body.prematchProvider);
  } else if (typeof body?.prematchProvider === "string" && body.prematchProvider === "") {
    await setSetting("odds.prematchProvider", "");
  }
  if (typeof body?.liveProvider === "string" && VALID_PROVIDERS.has(body.liveProvider)) {
    await setSetting("odds.liveProvider", body.liveProvider);
  } else if (typeof body?.liveProvider === "string" && body.liveProvider === "") {
    await setSetting("odds.liveProvider", "");
  }

  // New creds should take effect immediately — drop the stale feed snapshot.
  clearPrematchFeedCache();

  return ok({ message: "BetsAPI live credentials saved", primary: false });
});
