import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireAdmin, verifyCsrf } from "@/lib/api";
import { fetchOddsRetry } from "@/lib/odds-throttle";

/**
 * POST /api/admin/config/api/test — verify the The Odds API (v4) connection:
 *  1. GET /v4/sports            (quota-free — proves the key is valid)
 *  2. GET /v4/sports/soccer_epl/odds?markets=h2h,spreads,totals,correct_score
 *                               (proves odds access + the expanded market set)
 * Reports quota usage from the response headers.
 */
export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  await requireAdmin("settings");
  const body = await req.json().catch(() => null);
  const key = (typeof body?.apiKey === "string" && body.apiKey.trim()) || process.env.ODDS_API_KEY || "";

  if (!key) {
    throw new ApiError(400, "ODDS_API_KEY is not set — add it to the server environment first.", "VALIDATION");
  }

  const BASE = "https://api.the-odds-api.com/v4";
  const signal = AbortSignal.timeout(15000);
  const q = (path: string) => `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`;

  // Step 1 — sports list (quota-free)
  const listRes = await fetchOddsRetry(q("/sports"), { signal });
  const used = listRes.headers.get("x-requests-used");
  const remaining = listRes.headers.get("x-requests-remaining");
  if (!listRes.ok) {
    return ok({
      ok: false,
      step: "sports",
      status: listRes.status,
      error: (await listRes.text().catch(() => "")).slice(0, 300),
    });
  }
  const sports = (await listRes.json().catch(() => null)) as { key: string; title: string; active: boolean }[] | null;
  const activeSoccer = (sports ?? []).filter((s) => s.active && s.key.startsWith("soccer_")).length;

  // Step 2 — odds for one league with the expanded market set
  let markets: string[] = [];
  let marketSample: string | null = null;
  const oddsRes = await fetchOddsRetry(
    q("/sports/soccer_epl/odds?regions=us&markets=h2h,spreads,totals,h2h_h1,totals_h1,h2h_h2,totals_h2,correct_score&oddsFormat=decimal"),
    { signal },
  );
  if (oddsRes.ok) {
    const odds = (await oddsRes.json().catch(() => null)) as
      | { home_team?: string; away_team?: string; bookmakers: { markets: { key: string }[] }[] }[]
      | null;
    const first = odds?.[0];
    const seen = new Set<string>();
    for (const b of first?.bookmakers ?? []) {
      for (const m of b.markets) seen.add(m.key);
    }
    markets = [...seen];
    marketSample = first?.home_team ? `${first.home_team} vs ${first.away_team}` : null;
  }

  return ok({
    ok: true,
    step: "odds",
    status: oddsRes.status,
    quota: { used, remaining },
    activeSoccerLeagues: activeSoccer,
    markets,
    marketSample,
    note: oddsRes.ok ? "The Odds API connection verified — expanded markets returned." : "Key verified, odds call failed — see status.",
  });
});
