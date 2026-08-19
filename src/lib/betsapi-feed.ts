/**
 * BetsAPI live feed — the homepage's "no sync needed" data path.
 *
 * Shared by:
 *   - GET /api/betsapi/matches (proxy route)
 *   - the homepage server component (live rendering, DB fallback)
 *
 * Flow (sequential per the multi-endpoint spec):
 *   Step 1: /v1/bet365/upcoming?sport_id=1 → fixture ids
 *   Step 2: /v3/bet365/prematch?FI={id}    → 1X2 / totals / handicap markets
 *
 * Budget math (important): each refresh = 1 upcoming + 1 prematch per event.
 * With the defaults (6 events, 5-min cache) that is ~84 req/hr worst case —
 * above the BASIC plan's observed ~16/hr, so keep BETSAPI_FEED_EVENTS low or
 * raise the RapidAPI tier. Every request is TTL-cached in-process so page
 * loads between refreshes cost 0 requests.
 */
import type { FeedGame } from "@/components/MatchFeed";
import { getSettings } from "@/lib/settings";
import { BetsApiClient } from "@/lib/providers/betsapi-client";
import {
  RawBetsApiMatch,
  PrematchLike,
  MatchView,
  ViewMarket,
  transformBetsApiMatch,
  extractOddsMarkets,
} from "@/lib/providers/betsapi-transformer";

/** Feed size: prematch is 1 request per event. */
const FEED_EVENTS = Number(process.env.BETSAPI_FEED_EVENTS ?? 6) || 6;
/** In-process TTL so the homepage doesn't re-hit BetsAPI on every load. */
const FEED_TTL_SECONDS = Number(process.env.BETSAPI_FEED_TTL_SECONDS ?? 300) || 300;

export type BetsApiMatchView = MatchView & { markets: ViewMarket[] };

let cache: { at: number; matches: BetsApiMatchView[] } | null = null;

/**
 * Upcoming fixtures + prematch markets, transformed for the UI.
 * Throws when the feed is unreachable (no key / rate-limited / HTTP error) —
 * callers fall back to the DB feed. Per-event odds failures degrade to
 * `markets: []` instead of killing the whole list.
 */
export async function getBetsApiFeed(limit: number = FEED_EVENTS): Promise<BetsApiMatchView[]> {
  const ttlMs = FEED_TTL_SECONDS * 1000;
  if (cache && Date.now() - cache.at < ttlMs) return cache.matches;

  const client = await BetsApiClient.fromSettings();
  const margin = (await getSettings()).oddsMarginPercent;

  // Step 1 — fixture list (metadata only)
  const up = await client.getUpcomingEvents(1);
  const events = ((up.results ?? []) as RawBetsApiMatch[]).filter(
    (e) => String(e.time_status) === "0", // pre-match only
  );

  // Step 2 — prematch odds per fixture, sequential (1 request each)
  const matches: BetsApiMatchView[] = [];
  for (const ev of events.slice(0, Math.max(0, Math.min(limit, 50)))) {
    const homeTeam = ev.home?.name ?? "Home";
    const awayTeam = ev.away?.name ?? "Away";
    let markets: ViewMarket[] = [];
    try {
      const pm = await client.getPrematchOdds(String(ev.id));
      const first = ((pm.results ?? []) as PrematchLike[])[0] ?? null;
      markets = extractOddsMarkets(first, homeTeam, awayTeam, margin);
    } catch {
      /* odds optional — match still returned, markets: [] */
    }
    matches.push({ ...transformBetsApiMatch(ev), markets });
  }

  cache = { at: Date.now(), matches };
  return matches;
}

/** Clear the in-process cache (used by tests / admin actions if ever needed). */
export function clearBetsApiFeedCache(): void {
  cache = null;
}

/**
 * Adapt a transformed BetsAPI match into the card/feed shape the UI renders.
 * Synthetic ids (matchId-marketKey-outcomeName) keep betslip selections
 * unique without DB rows; `isApiMatch` hides DB-only links (fixture pages).
 */
export function apiMatchToFeedGame(view: BetsApiMatchView): FeedGame {
  const [hs, as] = view.score.split("-").map((n) => Number(n.trim()));
  const status: FeedGame["status"] =
    view.timeStatus === "1" ? "LIVE" : view.timeStatus === "3" ? "FINISHED" : "SCHEDULED";
  const startAt = new Date(view.kickoff);
  return {
    id: view.id,
    isApiMatch: true,
    homeName: view.homeTeam,
    awayName: view.awayTeam,
    homeLogo: null,
    awayLogo: null,
    startAt,
    status,
    homeScore: Number.isFinite(hs) ? hs : 0,
    awayScore: Number.isFinite(as) ? as : 0,
    period: null,
    clock: view.elapsedMinute || null,
    live: view.isLive,
    featured: false,
    sport: { name: "Football", slug: "football", icon: "⚽" },
    competitionName: view.leagueName,
    markets: view.markets.map((m) => ({
      id: `${view.id}-${m.key}`,
      name: m.name,
      key: m.key,
      status: "OPEN",
      outcomes: m.outcomes.map((o) => ({
        id: `${view.id}-${m.key}-${o.name}`,
        name: o.name,
        label: o.label ?? null,
        odds: o.odds,
        status: o.odds > 1 ? "ACTIVE" : "CLOSED",
      })),
    })),
  };
}
