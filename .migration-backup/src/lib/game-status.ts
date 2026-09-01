/**
 * Live-status helpers — single source of truth for "is this match in-play?".
 *
 * Live matches are isolated to the /live route: every other surface
 * (home feed, sports pages, slideshow) filters with isLiveStatus().
 */
export const LIVE_STATUSES = ["LIVE", "HALF_TIME", "IN_PLAY"] as const;

export function isLiveStatus(status: string, live?: boolean): boolean {
  return LIVE_STATUSES.includes(status as (typeof LIVE_STATUSES)[number]) || !!live;
}
