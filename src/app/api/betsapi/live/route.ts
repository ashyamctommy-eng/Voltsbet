import { handle, ok, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { BetsApiClient } from "@/lib/providers/betsapi-client";
import { RawBetsApiMatch, transformBetsApiMatch, MatchView } from "@/lib/providers/betsapi-transformer";

/**
 * GET /api/betsapi/live — in-play matches transformed for the UI.
 *
 * This endpoint is unauthenticated and each request burns a paid BetsAPI
 * call, so it is rate-limited per IP (30 req/min) AND the provider response
 * is cached for 30s — N browsers polling at once cost 1 provider call, and a
 * hostile client cannot drain the quota.
 *
 * RapidAPI may serve the RAW compressed bet365 format (array-of-arrays with
 * no team names) — in that case we return an empty list with a note instead
 * of a broken payload. Parsed feeds return MatchView objects (status "1").
 */

const CACHE_TTL_MS = 30_000;
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60_000;

let cache: { at: number; body: Record<string, unknown> } | null = null;

export const GET = handle(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = rateLimit(`betsapi-live:${ip}`, RATE_MAX, RATE_WINDOW_MS);
  if (!rl.ok) {
    throw new ApiError(429, "Too many requests — try again shortly.", "RATE_LIMITED");
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return ok(cache.body);
  }

  const client = await BetsApiClient.fromSettings();
  try {
    const res = await client.getInplay();
    const data = (res.results ?? []) as unknown[];
    let body: Record<string, unknown>;
    if (!Array.isArray(data) || !data.length) {
      body = { count: 0, matches: [], note: "no in-play events right now" };
    } else if (Array.isArray(data[0])) {
      body = {
        count: 0,
        matches: [],
        note: "RapidAPI served the RAW bet365 inplay format (no team names) — parsed feed unavailable on this host",
      };
    } else {
      const matches: MatchView[] = (data as RawBetsApiMatch[])
        .filter((e) => String(e.time_status) === "1")
        .map(transformBetsApiMatch);
      body = { count: matches.length, matches };
    }
    cache = { at: Date.now(), body };
    return ok(body);
  } catch (err) {
    return ok({
      count: 0,
      matches: [],
      error: err instanceof Error ? err.message : "In-play feed unavailable",
    });
  }
});
