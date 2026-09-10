/**
 * Live-status helpers — single source of truth for "is this match in-play?".
 *
 * Live matches are isolated to the /live route: every other surface
 * (home feed, sports pages, slideshow) filters with isLiveStatus().
 */
export const LIVE_STATUSES = ["LIVE", "HALF_TIME", "IN_PLAY"] as const;

/**
 * Live is decided by STATUS ONLY.
 *
 * The second parameter is kept for call-site compatibility but deliberately
 * ignored: the legacy `live` boolean drifted from `status` (finished rows
 * still flagged live) and made different surfaces disagree — the bottom-nav
 * badge counted 3 while /live counted 42. `status` is the single source of
 * truth; the sweep normalizes the flag for other consumers.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility
export function isLiveStatus(status: string, _live?: boolean): boolean {
  return LIVE_STATUSES.includes(status as (typeof LIVE_STATUSES)[number]);
}

/**
 * A market is bettable when it is OPEN and has at least one ACTIVE outcome
 * with a real price (> 1 decimal). Mirrors the Prisma predicate in
 * live-feed.ts — keep the two in step.
 */
export function isBettableMarket(m: {
  status: string;
  outcomes?: { status: string; odds: unknown }[] | null;
}): boolean {
  if (m.status !== "OPEN") return false;
  return (m.outcomes ?? []).some((o) => o.status === "ACTIVE" && Number(o.odds) > 1);
}

/** True when a game has any bettable market (drives /live visibility). */
export function hasBettableMarkets(
  markets?: { status: string; outcomes?: { status: string; odds: unknown }[] | null }[] | null,
): boolean {
  return (markets ?? []).some(isBettableMarket);
}
