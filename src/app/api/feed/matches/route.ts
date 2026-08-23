import { handle, ok, ApiError } from "@/lib/api";
import { getPrematchFeed } from "@/lib/feed";

export type { BetsApiMatchView } from "@/lib/feed";

/**
 * GET /api/feed/matches — today's pre-match fixtures with odds, transformed
 * for the UI. Source chain: The Odds API → API-Football → DB (see lib/feed).
 * In-process TTL cache (FEED_TTL_SECONDS, default 300) keeps page loads
 * request-free; stale snapshots are served while a quota window is active.
 */
export const GET = handle(async () => {
  try {
    const { matches, source } = await getPrematchFeed();
    return ok({ count: matches.length, matches, source });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Prematch feed unavailable";
    if (/quota|rate limit|rate_limit|exceeded/i.test(msg)) {
      throw new ApiError(429, msg, "RATE_LIMITED");
    }
    throw e;
  }
});
