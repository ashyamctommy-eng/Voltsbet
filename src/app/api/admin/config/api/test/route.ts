import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireAdmin, verifyCsrf } from "@/lib/api";
import { getSettings } from "@/lib/settings";

/**
 * POST /api/admin/config/api/test — verify the BetsAPI connection end-to-end:
 *  1. GET /v1/bet365/upcoming?sport_id=1   (fixture list — proves the key)
 *  2. GET /v3/bet365/prematch?FI=<first>    (deep odds — proves the parser's
 *     source of truth and shows the market count)
 */
export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  await requireAdmin("settings");
  const body = await req.json().catch(() => null);
  const s = await getSettings();

  const key = typeof body?.rapidKey === "string" && body.rapidKey.trim()
    ? body.rapidKey.trim()
    : s.apiRapidKey;
  const host =
    typeof body?.rapidHost === "string" && body.rapidHost.trim()
      ? body.rapidHost.trim()
      : s.apiRapidHost || "betsapi2.p.rapidapi.com";
  const base =
    typeof body?.rapidBase === "string" && body.rapidBase.trim()
      ? body.rapidBase.trim().replace(/\/+$/, "")
      : s.apiRapidBase || "https://betsapi2.p.rapidapi.com";

  if (!key) {
    throw new ApiError(400, "Enter an X-RapidAPI-Key first.", "VALIDATION");
  }

  const headers = { "x-rapidapi-key": key, "x-rapidapi-host": host };
  const signal = AbortSignal.timeout(15000);

  try {
    // Step 1 — fixture list
    const listRes = await fetch(`${base}/v1/bet365/upcoming?sport_id=1`, { headers, signal });
    const listText = await listRes.text();
    let list: { success?: number; error?: string; error_detail?: string; results?: { id: string; league?: { name?: string }; home?: { name?: string }; away?: { name?: string }; time?: string }[] } | null = null;
    try {
      list = JSON.parse(listText);
    } catch {
      /* not JSON */
    }
    if (!listRes.ok || list?.success !== 1) {
      return ok({
        ok: false,
        step: "upcoming",
        status: listRes.status,
        error: (list?.error_detail ?? list?.error ?? listText).slice(0, 300),
      });
    }
    const events = list.results ?? [];
    const first = events[0];

    // Step 2 — prematch deep odds for the first event
    const prematch: { markets?: string[]; sample?: string; error?: string } = { markets: [] };
    if (first) {
      const pmRes = await fetch(`${base}/v3/bet365/prematch?FI=${encodeURIComponent(first.id)}`, { headers, signal });
      const pmText = await pmRes.text();
      try {
        const pm = JSON.parse(pmText) as { success?: number; results?: { main?: { sp?: Record<string, unknown> } }[] };
        if (pm.success === 1) {
          const sp = pm.results?.[0]?.main?.sp ?? {};
          prematch.markets = Object.keys(sp);
        } else {
          prematch.error = pmText.slice(0, 200);
        }
      } catch {
        prematch.error = pmText.slice(0, 200);
      }
      prematch.sample = first.league?.name
        ? `${first.league.name} — ${first.home?.name ?? "?"} vs ${first.away?.name ?? "?"}`
        : `${first.home?.name ?? "?"} vs ${first.away?.name ?? "?"}`;
    }

    return ok({
      ok: true,
      status: listRes.status,
      events: events.length,
      sample: prematch.sample ?? null,
      prematchMarkets: prematch.markets ?? [],
      prematchError: prematch.error ?? null,
    });
  } catch (err) {
    return ok({
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});
