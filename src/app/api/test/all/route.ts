import { handle, ok, requireAdmin } from "@/lib/api";
import { BetsApiClient, firstId } from "@/lib/providers/betsapi-client";

type Check = {
  endpoint: string;
  status: "ok" | "error" | "skipped";
  httpStatus?: number;
  hasResults: boolean;
  note?: string;
};

/** True when `results` carries any payload (array with items or non-empty object). */
function hasData(results: unknown): boolean {
  if (Array.isArray(results)) return results.length > 0;
  return !!results && typeof results === "object" && Object.keys(results as object).length > 0;
}

/** In-play results may be the RAW compressed format (array-of-arrays) — no id. */
function inplayId(results: unknown): string | null {
  if (!Array.isArray(results) || !results.length) return null;
  if (Array.isArray(results[0])) return null; // raw format
  return firstId(results);
}

const count = (results: unknown) =>
  Array.isArray(results) ? results.length : results && typeof results === "object" ? Object.keys(results as object).length : 0;

/**
 * GET /api/test/all — sequential health check across all 7 BetsAPI endpoints.
 * Ids for getInplayEvent / getResults / getPrematchOdds are extracted at
 * runtime from live responses (inplay first, then upcoming).
 *
 * Admin-only: this burns up to ~7 requests per hit on a rate-limited plan.
 */
export const GET = handle(async () => {
  await requireAdmin("settings");
  const client = await BetsApiClient.fromSettings();
  const checks: Check[] = [];

  if (!client.hasCredentials()) {
    return ok({
      checks: [{ endpoint: "all", status: "skipped", hasResults: false, note: "RapidAPI key not configured — Admin → API Settings" }],
    });
  }

  const run = async (
    endpoint: string,
    fn: () => Promise<{ results: unknown }>,
    after?: (results: unknown) => void,
  ): Promise<void> => {
    try {
      const res = await fn();
      after?.(res.results);
      checks.push({
        endpoint,
        status: "ok",
        httpStatus: 200,
        hasResults: hasData(res.results),
        note: `${count(res.results)} results`,
      });
    } catch (err) {
      const status = err instanceof Error && "status" in err ? Number((err as { status: number }).status) : undefined;
      checks.push({
        endpoint,
        status: "error",
        httpStatus: status,
        hasResults: false,
        note: (err instanceof Error ? err.message : String(err)).slice(0, 160),
      });
    }
  };

  // 1 — In-Play Filter
  await run("1 · inplay_filter", () => client.getInplayFilter());

  // 2 — In-Play (capture an id for the event/result checks)
  let liveId: string | null = null;
  await run("2 · inplay", () => client.getInplay(), (r) => {
    liveId = inplayId(r);
  });

  // 4 — Upcoming Events (id fallback + the FI source for prematch)
  let upcomingId: string | null = null;
  await run("4 · upcoming", () => client.getUpcomingEvents(), (r) => {
    upcomingId = firstId(r);
  });

  // 5 — Upcoming Leagues
  await run("5 · league", () => client.getUpcomingLeagues());

  // 6 — Pre-Match Odds (FI required)
  const fi = upcomingId ?? liveId;
  if (fi) {
    await run(`6 · prematch (FI=${fi})`, () => client.getPrematchOdds(fi));
  } else {
    checks.push({ endpoint: "6 · prematch", status: "skipped", hasResults: false, note: "no FI available from live responses" });
  }

  // 3 — In-Play Event (stats=1&lineup=1&FI=)
  const eventId = liveId ?? upcomingId;
  if (eventId) {
    await run(`3 · inplay_event (FI=${eventId})`, () => client.getInplayEvent(eventId));
  } else {
    checks.push({ endpoint: "3 · inplay_event", status: "skipped", hasResults: false, note: "no active id available" });
  }

  // 7 — Results (settlement)
  if (eventId) {
    await run(`7 · result (event_id=${eventId})`, () => client.getResults(eventId));
  } else {
    checks.push({ endpoint: "7 · result", status: "skipped", hasResults: false, note: "no active id available" });
  }

  const okCount = checks.filter((c) => c.status === "ok").length;
  return ok({
    checks,
    summary: { total: checks.length, ok: okCount, failed: checks.length - okCount },
  });
});
