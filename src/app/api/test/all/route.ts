import { handle, ok, requireAdmin } from "@/lib/api";
import { fetchOddsRetry } from "@/lib/odds-throttle";

type Check = {
  endpoint: string;
  status: "ok" | "error" | "skipped";
  httpStatus?: number;
  note?: string;
};

const BASE = "https://api.the-odds-api.com/v4";

/**
 * GET /api/test/all — sequential health check of The Odds API (v4).
 *  1. GET /sports                    (does NOT count toward monthly quota)
 *  2. GET /sports/soccer_epl/odds    (proves odds access + market payload)
 *  3. GET /sports/soccer_epl/scores  (proves the live/scores pipeline)
 *
 * Admin-only: burns up to ~3 requests per hit on a quota-metered plan.
 */
export const GET = handle(async () => {
  await requireAdmin("settings");
  const key = process.env.ODDS_API_KEY;
  const checks: Check[] = [];

  if (!key) {
    return ok({
      checks: [{ endpoint: "all", status: "skipped", httpStatus: undefined, note: "ODDS_API_KEY not set — configure the env var" }],
      quota: null,
    });
  }

  let quota: { used?: string; remaining?: string } | null = null;

  const run = async (endpoint: string, path: string): Promise<void> => {
    try {
      const res = await fetchOddsRetry(`${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`);
      quota = {
        used: res.headers.get("x-requests-used") ?? undefined,
        remaining: res.headers.get("x-requests-remaining") ?? undefined,
      };
      if (!res.ok) {
        checks.push({
          endpoint,
          status: "error",
          httpStatus: res.status,
          note: (await res.text().catch(() => "")).slice(0, 160),
        });
        return;
      }
      const data = (await res.json().catch(() => null)) as unknown[] | null;
      checks.push({
        endpoint,
        status: "ok",
        httpStatus: res.status,
        note: `${Array.isArray(data) ? data.length : "?"} results`,
      });
    } catch (err) {
      checks.push({
        endpoint,
        status: "error",
        httpStatus: undefined,
        note: (err instanceof Error ? err.message : String(err)).slice(0, 160),
      });
    }
  };

  await run("1 · sports (quota-free)", "/sports");
  await run("2 · odds soccer_epl", "/sports/soccer_epl/odds?regions=us&markets=h2h,spreads,totals,correct_score&oddsFormat=decimal");
  await run("3 · scores soccer_epl", "/sports/soccer_epl/scores?daysFrom=1");

  const okCount = checks.filter((c) => c.status === "ok").length;
  return ok({
    checks,
    quota,
    summary: { total: checks.length, ok: okCount, failed: checks.length - okCount },
  });
});
