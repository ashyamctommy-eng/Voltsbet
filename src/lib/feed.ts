/**
 * Prematch feed — the homepage's "today's games" data path.
 *
 * Clean provider chain (no conflicts, no stale multi-provider stacking):
 *   1. The Odds API   (ODDS_API_KEY)    — primary. Free 500 req/month, clean
 *                                         h2h + totals odds, eu/us regions.
 *   2. API-Football   (ODDS_API_IO_KEY) — fallback. Free 100 req/day, global
 *                                         + African leagues.
 *   3. DB             — synced games; the feed never goes empty.
 *
 * Live matches are NOT in this feed — they belong on /live (the BetsAPI
 * in-play engine, separate surface, see src/lib/live-scores.ts).
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
import { TheOddsApi } from "@/lib/providers/odds-api";
import { ApiFootballProvider } from "@/lib/providers/api-football";
import { formatKickoff } from "@/lib/kickoff";
import { BetsApiMatchView } from "@/lib/providers/betsapi-transformer";

export { apiMatchToFeedGame } from "@/lib/providers/betsapi-transformer";
export type { BetsApiMatchView, ApiFeedGame } from "@/lib/providers/betsapi-transformer";

/** Feed size (matches rendered). */
const FEED_EVENTS = Number(process.env.FEED_EVENTS ?? process.env.BETSAPI_FEED_EVENTS ?? 12) || 12;
/** In-process TTL — the API is only a cold-start bootstrap now (the homepage
 *  renders synced DB games first), so a long TTL keeps the free-tier quota
 *  intact even when the DB is empty. */
const FEED_TTL_SECONDS = Number(process.env.FEED_TTL_SECONDS ?? 6 * 60 * 60) || 21600;

/** Preferred soccer leagues for the feed; override via ODDS_API_FALLBACK_LEAGUES
 *  (1 credit each against The Odds API). */
const FEED_LEAGUES = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
];

export type FeedSource = "the-odds-api" | "api-football";

let cache: { at: number; matches: BetsApiMatchView[]; source: FeedSource } | null = null;

/** The Odds API sport key → display league name ("soccer_epl" → "England - Premier League"). */
const LEAGUE_TITLES: Record<string, string> = {
  soccer_epl: "England - Premier League",
  soccer_spain_la_liga: "Spain - La Liga",
  soccer_germany_bundesliga: "Germany - Bundesliga",
  soccer_italy_serie_a: "Italy - Serie A",
  soccer_france_ligue_one: "France - Ligue 1",
  soccer_uefa_champs_league: "Europe - UEFA Champions League",
  soccer_uefa_europa_league: "Europe - UEFA Europa League",
  soccer_netherlands_eredivisie: "Netherlands - Eredivisie",
  soccer_portugal_primeira_liga: "Portugal - Primeira Liga",
  soccer_brazil_campeonato: "Brazil - Serie A",
};

/**
 * Today's + upcoming pre-match fixtures with odds, transformed for the UI.
 * Primary source is The Odds API; when it is unreachable (no key / quota spent
 * / HTTP error) the feed falls back to API-Football, then to the synced DB.
 * A stale snapshot is served while every source is down (stale-while-error).
 */
export async function getPrematchFeed(
  limit: number = FEED_EVENTS,
): Promise<{ matches: BetsApiMatchView[]; source: FeedSource }> {
  const ttlMs = FEED_TTL_SECONDS * 1000;
  if (cache && Date.now() - cache.at < ttlMs) {
    return { matches: cache.matches, source: cache.source };
  }

  // 1) The Odds API — primary pre-match source.
  if (process.env.ODDS_API_KEY) {
    try {
      const provider = new TheOddsApi();
      const sports = await provider.fetchSports();
      const preferred = (process.env.ODDS_API_FALLBACK_LEAGUES ?? FEED_LEAGUES.join(","))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const chosen = preferred.filter((k) => sports.some((s) => s.key === k));
      const keys = (chosen.length ? chosen : sports.filter((s) => s.key.startsWith("soccer_")).map((s) => s.key).slice(0, FEED_LEAGUES.length)).slice(0, FEED_LEAGUES.length);
      if (keys.length) {
        const games = await provider.fetchUpcomingGames(keys);
        const matches = games
          .filter((g) => g.startAt.getTime() > Date.now() - 30 * 60_000) // keep ~now + upcoming
          .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
          .slice(0, limit)
          .map(apiGameToMatchView);
        if (matches.length) {
          cache = { at: Date.now(), matches, source: "the-odds-api" };
          return { matches, source: "the-odds-api" };
        }
      }
    } catch {
      /* fall through to API-Football */
    }
  }

  // 2) API-Football — global + African leagues fallback.
  if (process.env.ODDS_API_IO_KEY) {
    try {
      const provider = new ApiFootballProvider();
      const games = await provider.fetchUpcomingGames(["football"]);
      const matches = games
        .filter((g) => g.startAt.getTime() > Date.now() - 30 * 60_000)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .slice(0, limit)
        .map(apiGameToMatchView);
      if (matches.length) {
        cache = { at: Date.now(), matches, source: "api-football" };
        return { matches, source: "api-football" };
      }
    } catch {
      /* no fallback available */
    }
  }

  // 3) Stale snapshot while every source is down, else empty (DB covers).
  if (cache) return { matches: cache.matches, source: cache.source };
  return { matches: [], source: "the-odds-api" };
}

/** Adapt an ApiGame (The Odds API / API-Football) into the standard MatchView contract. */
function apiGameToMatchView(g: {
  externalId: string;
  sportKey: string;
  competitionName?: string;
  homeName: string;
  awayName: string;
  startAt: Date;
  markets: { key: string; name: string; outcomes: { name: string; label?: string; odds: number }[] }[];
}): BetsApiMatchView {
  const d = g.startAt;
  return {
    id: g.externalId,
    isLive: false,
    timeStatus: "0",
    leagueName: g.competitionName ?? LEAGUE_TITLES[g.sportKey] ?? "Football",
    homeTeam: g.homeName,
    awayTeam: g.awayName,
    score: "0-0",
    elapsedMinute: "",
    kickoff: d.toISOString(),
    kickoffTimeFormatted: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    kickoffDateFormatted: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    kickoffLabel: formatKickoff(d),
    markets: g.markets.map((m) => ({
      key: m.key,
      name: m.name,
      outcomes: m.outcomes.map((o) => ({ name: o.name, label: o.label, odds: o.odds })),
    })),
  };
}

/** Clear the in-process cache (used by tests / admin actions if ever needed). */
export function clearPrematchFeedCache(): void {
  cache = null;
}
