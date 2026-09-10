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

/** True when the estimated clock/period says the match is in the interval. */
export function isHalfTimeScore(s: { period?: string | null; clock?: string | null }): boolean {
  const p = (s.period ?? "").trim().toLowerCase();
  const c = (s.clock ?? "").trim().toLowerCase();
  return p === "ht" || p.includes("half") || c === "ht";
}

/** Estimated extra-time half ("ET1"/"ET2"). */
export function isExtraTimePeriod(period: string | null | undefined): boolean {
  return /^et[12]?$/i.test((period ?? "").trim());
}

/** Shootout ("PENS") or the persisted finish marker. */
export function isPenaltiesPeriod(period: string | null | undefined): boolean {
  return /^(pens?|penalt|shootout)/i.test((period ?? "").trim());
}

/** A match whose finish left normal time — 90-minute markets must NOT be
 *  auto-settled from a score that may include extra time / shootout goals. */
export function isKnockoutFinishPeriod(period: string | null | undefined): boolean {
  const p = (period ?? "").trim().toUpperCase();
  return p === "AET" || isPenaltiesPeriod(p);
}

export type ScoreStatusInput = {
  /** "cancelled"/"postponed" are accepted and treated as not-in-play (the
   *  sweep has always mapped them to SCHEDULED). */
  status: "live" | "finished" | "scheduled" | "cancelled" | "postponed";
  sportKey?: string | null;
  period?: string | null;
  clock?: string | null;
};

/**
 * Persisted status for a provider score event.
 *
 * The Odds API /scores exposes no match minute, so the clock/period are
 * ESTIMATED from kickoff (45' → 15-min interval → 45'). That model is
 * soccer's, so HALF_TIME is only ever claimed for soccer: for other sports a
 * 46-minute-old game is simply LIVE (we must not park a basketball game at
 * "half time"). Without this the interval left rows at LIVE with a clock of
 * "HT", which the card rendered as nothing at all.
 */
export function scoreToGameStatus(
  s: ScoreStatusInput,
): "LIVE" | "HALF_TIME" | "FINISHED" | "SCHEDULED" {
  if (s.status === "finished") return "FINISHED";
  if (s.status !== "live") return "SCHEDULED";
  if ((s.sportKey ?? "").startsWith("soccer") && isHalfTimeScore(s)) return "HALF_TIME";
  return "LIVE";
}

/** Number of bettable markets on a card — the "+N Markets" badge count.
 *  Returns 0 when nothing is bettable, so callers can hide the badge. */
export function activeMarketCount(
  markets?: { status: string; outcomes?: { status: string; odds: unknown }[] | null }[] | null,
): number {
  return (markets ?? []).filter(isBettableMarket).length;
}

/** True when the game has ANY recorded outcome, bettable or not — used to
 *  decide whether a card may say "Market Suspended" (only when truly bare). */
export function hasAnyOutcomes(
  markets?: { status?: string; outcomes?: { status: string; odds: unknown }[] | null }[] | null,
): boolean {
  return (markets ?? []).some((m) => (m.outcomes?.length ?? 0) > 0);
}

/** True when a game has any bettable market (drives /live visibility). */
export function hasBettableMarkets(
  markets?: { status: string; outcomes?: { status: string; odds: unknown }[] | null }[] | null,
): boolean {
  return (markets ?? []).some(isBettableMarket);
}
