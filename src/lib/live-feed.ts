/**
 * Canonical definition of the PUBLIC LIVE FEED.
 *
 * Single source of truth shared by the bottom-nav badge, the /live header
 * count and the rendered cards. They drifted because the badge counted
 * `status` while the page counted `status OR live:true`, so stale `live`
 * flags (rows finished long ago) inflated the page count to "42 live" while
 * the badge said 3.
 *
 * Rules (all three consumers must use `liveFeedWhere()`):
 *   1. status ∈ LIVE_STATUSES  — `status` is the ONLY live signal; the legacy
 *      `live` boolean is not trusted here (the sweep keeps it in step).
 *   2. externalId NOT NULL and source = API — orphan/seed rows never show.
 *   3. at least one bettable market (OPEN market + ACTIVE priced outcome) —
 *      no "Market Suspended / +0 Markets" cards.
 *   4. touched by the API sweep within LIVE_FEED_FRESH_MINUTES — a live row
 *      the feed stopped reporting drops off the public live feed instead of
 *      lingering all day.
 *
 * Pure module (no Prisma import) so client components can share the helpers.
 */
import { LIVE_STATUSES } from "./game-status";

/** A live row must have been reported by the API within this window. */
export const LIVE_FEED_FRESH_MINUTES = Number(process.env.LIVE_FEED_FRESH_MINUTES ?? 30) || 30;

/** Hard cap on rendered live cards (the count query stays uncapped). */
export const LIVE_FEED_TAKE = 100;

/** Prisma predicate: the game has at least one bettable market. */
export const BETTABLE_MARKET_PREDICATE = {
  status: "OPEN",
  outcomes: { some: { status: "ACTIVE", odds: { gt: 1 } } },
} as const;

/** The one WHERE clause every live-count and live-list caller must use. */
export function liveFeedWhere(now: Date = new Date()) {
  return {
    externalId: { not: null },
    source: "API",
    status: { in: [...LIVE_STATUSES] },
    markets: { some: BETTABLE_MARKET_PREDICATE },
    updatedAt: { gte: new Date(now.getTime() - LIVE_FEED_FRESH_MINUTES * 60_000) },
  };
}

/** Shared include so cards always carry sport + ordered markets/outcomes. */
export const LIVE_FEED_INCLUDE = {
  sport: true,
  markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" as const } },
} as const;
