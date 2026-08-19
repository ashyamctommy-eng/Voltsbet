import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf } from "@/lib/api";
import { getSettings, setSetting } from "@/lib/settings";

/**
 * Admin API config — BetsAPI (bet365 via RapidAPI) primary provider settings.
 *
 * GET  /api/admin/config/api      → current config (key masked)
 * POST /api/admin/config/api      → persist creds; `primary: true` also flips
 *                                   odds.provider → "betsapi"
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
      primary: s.oddsProvider === "betsapi",
    },
  });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("settings");
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

  if (body?.primary === true) {
    await setSetting("odds.provider", "betsapi");
  }

  return ok({
    message: body?.primary === true ? "Saved — BetsAPI is now the primary provider" : "API settings saved",
    primary: body?.primary === true ? true : s.oddsProvider === "betsapi",
  });
});
