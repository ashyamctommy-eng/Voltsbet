import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireAdmin, verifyCsrf } from "@/lib/api";
import { getSettings } from "@/lib/settings";

/**
 * POST /api/admin/config/api/test — ping the BetsAPI prematch endpoint with
 * the submitted (or saved) RapidAPI credentials and report what comes back.
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

  const url = `${base}/v3/bet365/prematch?sport_id=1`;
  try {
    const res = await fetch(url, {
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": host },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json: { success?: number; error?: unknown; results?: unknown[]; pager?: unknown } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      return ok({
        ok: false,
        status: res.status,
        error: text.slice(0, 300),
      });
    }
    if (json?.success !== 1) {
      return ok({
        ok: false,
        status: res.status,
        error: JSON.stringify(json?.error ?? json).slice(0, 300),
      });
    }
    const first = (json.results?.[0] as { league?: { name?: string }; home?: { name?: string }; away?: { name?: string } }) ?? null;
    return ok({
      ok: true,
      status: res.status,
      results: json.results?.length ?? 0,
      sample: first
        ? `${first.league?.name ?? "?"} — ${first.home?.name ?? "?"} vs ${first.away?.name ?? "?"}`
        : null,
    });
  } catch (err) {
    return ok({
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});
