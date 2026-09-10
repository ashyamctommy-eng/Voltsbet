import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/api";
import { refreshDetailMarkets } from "@/lib/detail-odds";

/**
 * GET /api/games/[eventId] — TIER 2 match-detail odds.
 *
 * `eventId` may be the internal game id or the provider externalId.
 * Serves the cached (DB) markets when the last fetch is inside
 * soccer.detailCacheTtlSeconds (default 45s); otherwise fetches the deep
 * single-event menu from The Odds API, upserts it and returns it.
 *
 * Public read (match detail pages are public), but cost is bounded: one API
 * request per event per TTL window, with concurrent callers sharing a promise.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) => {
  const { eventId } = await ctx.params;
  if (!eventId) throw new ApiError(400, "Missing event id", "BAD_REQUEST");

  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await refreshDetailMarkets(eventId, { force });
  if (!result.gameId) throw new ApiError(404, "Game not found", "NOT_FOUND");

  return ok({
    gameId: result.gameId,
    source: result.source,
    fetchedAt: result.fetchedAt ? new Date(result.fetchedAt).toISOString() : null,
    ttlSeconds: result.ttlSeconds,
    detailMarkets: result.detailMarkets,
    count: result.markets.length,
    markets: result.markets.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      status: m.status,
      outcomes: m.outcomes.map((o) => ({ id: o.id, name: o.name, label: o.label, odds: Number(o.odds), status: o.status })),
    })),
  });
});
