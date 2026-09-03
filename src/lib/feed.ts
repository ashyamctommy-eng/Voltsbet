/**
 * Prematch feed — the homepage's "today's games" data path.
 *
 * Clean provider chain (single provider, no stale multi-provider stacking):
 *   1. The Odds API   (ODDS_API_KEY) — the ONLY sports data provider.
 *   2. DB             — synced games; the feed never goes empty.
 *
 * Live matches are NOT in this feed — they belong on /live (the same The
 * Odds API /scores pipeline, separate surface, see src/lib/live-scores.ts).
 *
 * Shared by:
 *   - GET /api/feed/matches (proxy route)
 *   - the homepage server component (live rendering, DB fallback)
 *   - MatchFeed's client-side auto-fetch (module-level client cache)
 *
 * Budget: each refresh = 1 request per preferred league (default 6 soccer
 * leagues) against The Odds API, TTL-cached in-process (5 min) so page loads
 * between refreshes cost 0 requests.
 */
import { TheOddsApi, type ApiGame } from "@/lib/providers/odds-api";
import { leagueRank } from "@/lib/league-rank";
import { apiGameToMatchView, type FeedMatchView } from "@/lib/match-view";
import { LEAGUE_TITLES } from "./league-titles";

export { apiMatchToFeedGame } from "@/lib/match-view";
export type { FeedMatchView, ApiFeedGame, MatchView, ViewMarket } from "@/lib/match-view";

/** Feed size (matches rendered). */
const FEED_EVENTS = Number(process.env.FEED_EVENTS ?? 12) || 12;
/** In-process TTL — the API is only a cold-start bootstrap now (the homepage
 *  renders synced DB games first), so a long TTL keeps the free-tier quota
 *  intact even when the DB is empty. */
const FEED_TTL_SECONDS = Number(process.env.FEED_TTL_SECONDS ?? 6 * 60 * 60) || 21600;
/** Cap on leagues queried per feed refresh when no ODDS_API_FALLBACK_LEAGUES
 *  override is set (1 request per league). The feed is TTL-cached and only
 *  bootstraps on a cold DB, so 60 leagues keeps the free tier safe while
 *  still covering every active, priced soccer league. */
export const FEED_MAX_LEAGUES = Number(process.env.ODDS_API_FEED_MAX_LEAGUES ?? 120) || 120;

/** Preferred soccer leagues for the feed; override via ODDS_API_FALLBACK_LEAGUES
 *  (1 credit each against The Odds API). Priority: UEFA → EFL → La Liga →
 *  rest of the big five (product decision 2026-08-25). */
export const FEED_LEAGUES = [
  "soccer_uefa_champs_league",
  "soccer_uefa_champs_league_qualification",
  "soccer_uefa_europa_league",
  "soccer_uefa_nations_league",
  "soccer_efl_champ",
  "soccer_england_league1",
  "soccer_england_league2",
  "soccer_england_efl_cup",
  "soccer_spain_la_liga",
  "soccer_epl",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  // Verified priced additions — live US free-tier probe 2026-08-25
  "soccer_italy_serie_b",
  "soccer_germany_bundesliga2",
  "soccer_france_ligue_two",
  "soccer_spain_segunda_division",
  "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga",
  "soccer_spl",
  "soccer_brazil_campeonato",
  "soccer_usa_mls",
  "soccer_turkey_super_league",
];

export type FeedSource = "the-odds-api";

let cache: { at: number; matches: FeedMatchView[]; source: FeedSource } | null = null;

/**
 * Today's + upcoming pre-match fixtures with odds, transformed for the UI.
 * Source: The Odds API; when it is unreachable (no key / quota spent / HTTP
 * error) the feed falls back to the synced DB. A stale snapshot is served
 * while every source is down (stale-while-error).
 *
 * Past fixtures never reach the feed: the provider call itself is filtered
 * to commence_time > now, and the DB fallback filters startAt > now — a
 * match that already kicked off is not pre-match, it belongs on /live.
 */
export async function getPrematchFeed(
  limit: number = FEED_EVENTS,
): Promise<{ matches: FeedMatchView[]; source: FeedSource }> {
  const ttlMs = FEED_TTL_SECONDS * 1000;
  if (cache && Date.now() - cache.at < ttlMs) {
    return { matches: cache.matches, source: cache.source };
  }

  // 1) The Odds API — the only pre-match source.
  if (process.env.ODDS_API_KEY) {
    try {
      const provider = new TheOddsApi();
      const sports = await provider.fetchSports();
      // League selection: an explicit ODDS_API_FALLBACK_LEAGUES override
      // wins; otherwise query ALL active soccer leagues (never restricted
      // to a small hardcoded set like EFL/LaLiga only) — priority-ordered
      // with the verified-popular FEED_LEAGUES first, then the remaining
      // active leagues, capped by ODDS_API_FEED_MAX_LEAGUES.
      const override = (process.env.ODDS_API_FALLBACK_LEAGUES ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let keys: string[];
      if (override.length) {
        keys = override.filter((k) => sports.some((s) => s.key === k));
      } else {
        keys = sports
          .filter((s) => s.key.startsWith("soccer_"))
          .sort((a, b) => {
            const ia = FEED_LEAGUES.indexOf(a.key);
            const ib = FEED_LEAGUES.indexOf(b.key);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.key.localeCompare(b.key);
          })
          .map((s) => s.key)
          .slice(0, FEED_MAX_LEAGUES);
      }
      if (keys.length) {
        const games = await provider.fetchUpcomingGames(keys);
        const matches = games
          .filter((g) => g.markets?.length > 0) // unpriced fixtures never display
          .sort((a, b) => {
            // Popularity first (UEFA → EFL → La Liga → big five → rest),
            // then kickoff — the top slice always favors recognizable
            // leagues over obscure ones that happen to kick off sooner.
            const rankDelta = feedLeagueRank(a) - feedLeagueRank(b);
            if (rankDelta !== 0) return rankDelta;
            return a.startAt.getTime() - b.startAt.getTime();
          })
          .slice(0, limit)
          .map(apiGameToMatchView);
        if (matches.length) {
          cache = { at: Date.now(), matches, source: "the-odds-api" };
          return { matches, source: "the-odds-api" };
        }
      }
    } catch {
      /* fall through to the synced DB */
    }
  }

  // 2) Stale snapshot while every source is down, else empty (DB covers).
  if (cache) return { matches: cache.matches, source: cache.source };
  return { matches: [], source: "the-odds-api" };
}

/** Popularity rank for a fetched ApiGame — verified-popular FEED_LEAGUES
 *  first (UEFA → EFL → La Liga → big five → priced additions), then the
 *  shared league-rank table for everything else, then the long tail. */
function feedLeagueRank(g: ApiGame): number {
  const i = FEED_LEAGUES.indexOf(g.sportKey);
  if (i !== -1) return i;
  const title = g.competitionName ?? LEAGUE_TITLES[g.sportKey] ?? g.sportKey;
  return FEED_LEAGUES.length + leagueRank(title);
}

/** Clear the in-process cache (used by tests / admin actions if ever needed). */
export function clearPrematchFeedCache(): void {
  cache = null;
}
