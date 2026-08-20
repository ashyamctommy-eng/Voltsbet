/**
 * BetsAPI live feed — the homepage's "no sync needed" data path.
 *
 * Shared by:
 *   - GET /api/betsapi/matches (proxy route)
 *   - the homepage server component (live rendering, DB fallback)
 *   - MatchFeed's client-side auto-fetch (module-level client cache)
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
import { getSettings } from "@/lib/settings";
import { BetsApiClient } from "@/lib/providers/betsapi-client";
import { TheOddsApi } from "@/lib/providers/odds-api";
import { fetchOddspapiFeed } from "@/lib/providers/oddspapi";
import { formatKickoff } from "@/lib/kickoff";
import {
  RawBetsApiMatch,
  PrematchLike,
  ViewMarket,
  BetsApiMatchView,
  transformBetsApiMatch,
  extractOddsMarkets,
} from "@/lib/providers/betsapi-transformer";

export {
  apiMatchToFeedGame,
} from "@/lib/providers/betsapi-transformer";
export type { BetsApiMatchView, ApiFeedGame } from "@/lib/providers/betsapi-transformer";

/** Feed size: prematch is 1 request per event. */
const FEED_EVENTS = Number(process.env.BETSAPI_FEED_EVENTS ?? 6) || 6;
/** In-process TTL so the homepage doesn't re-hit BetsAPI on every load. */
const FEED_TTL_SECONDS = Number(process.env.BETSAPI_FEED_TTL_SECONDS ?? 300) || 300;

/** Fallback (The Odds API) request budget — 1 credit per league per refresh. */
const FALLBACK_LEAGUE_LIMIT = 6;
/** Preferred soccer leagues for the fallback; override via ODDS_API_FALLBACK_LEAGUES. */
const FALLBACK_LEAGUES = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
];

export type FeedSource = "betsapi" | "oddspapi" | "the-odds-api";

let cache: { at: number; matches: BetsApiMatchView[]; source: FeedSource } | null = null;

/** The Odds API sport key → display league name ("soccer_epl" → "English Premier League"). */
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
 * Upcoming fixtures + prematch markets, transformed for the UI.
 * Primary source is BetsAPI; when it is unreachable (no key / quota spent /
 * HTTP error) the feed falls back to The Odds API (free tier, env
 * ODDS_API_KEY) so the homepage degrades to pre-match odds instead of going
 * empty. Per-event odds failures degrade to `markets: []` per match, and a
 * stale snapshot is served while every source is down (stale-while-error).
 */
export async function getBetsApiFeed(
  limit: number = FEED_EVENTS,
): Promise<{ matches: BetsApiMatchView[]; source: FeedSource }> {
  const ttlMs = FEED_TTL_SECONDS * 1000;
  if (cache && Date.now() - cache.at < ttlMs) {
    return { matches: cache.matches, source: cache.source };
  }

  try {
    const matches = await fetchBetsApiFeed(limit);
    cache = { at: Date.now(), matches, source: "betsapi" };
    return { matches, source: "betsapi" };
  } catch (e) {
    // BetsAPI is down (rate-limited, key missing, HTTP error) — try the free
    // fallbacks (OddsPapi → The Odds API) before giving up.
    const fallback = await tryFreeFallback(limit);
    if (fallback.matches.length) {
      cache = { at: Date.now(), matches: fallback.matches, source: fallback.source };
      return fallback;
    }
    if (cache) return { matches: cache.matches, source: cache.source }; // stale snapshot
    throw e;
  }
}

/** BetsAPI path: upcoming list (1 req) + prematch per event (sequential). */
async function fetchBetsApiFeed(limit: number): Promise<BetsApiMatchView[]> {
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
  return matches;
}

/**
 * Fallback chain — OddsPapi (Pinnacle sharp lines, 250 free req/month) then
 * The Odds API (500 free credits/month). Only runs when BetsAPI failed and a
 * fallback key is configured. Future fixtures only, chronological, capped.
 */
async function tryFreeFallback(limit: number): Promise<{ matches: BetsApiMatchView[]; source: FeedSource }> {
  const cap = Math.max(0, Math.min(limit, 50));

  if (process.env.ODDSPAPI_KEY) {
    try {
      const games = await fetchOddspapiFeed({
        key: process.env.ODDSPAPI_KEY,
        margin: (await getSettings()).oddsMarginPercent,
        maxLeagues: 5, // keep the free-plan quota in check
      });
      const matches = games
        .filter((g) => g.startAt.getTime() > Date.now())
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .slice(0, cap)
        .map(apiGameToMatchView);
      if (matches.length) return { matches, source: "oddspapi" };
    } catch {
      /* fall through to the next source */
    }
  }

  if (process.env.ODDS_API_KEY) {
    try {
      const provider = new TheOddsApi();
      const sports = await provider.fetchSports();
      const preferred = (process.env.ODDS_API_FALLBACK_LEAGUES ?? FALLBACK_LEAGUES.join(","))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const chosen = preferred.filter((k) => sports.some((s) => s.key === k));
      const keys =
        (chosen.length
          ? chosen
          : sports
              .filter((s) => s.key.startsWith("soccer_"))
              .map((s) => s.key)
              .slice(0, FALLBACK_LEAGUE_LIMIT))
            .slice(0, FALLBACK_LEAGUE_LIMIT);
      if (!keys.length) return { matches: [], source: "the-odds-api" };
      const games = await provider.fetchUpcomingGames(keys);
      const matches = games
        .filter((g) => g.startAt.getTime() > Date.now())
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .slice(0, cap)
        .map(apiGameToMatchView);
      if (matches.length) return { matches, source: "the-odds-api" };
    } catch {
      /* no fallback available */
    }
  }
  return { matches: [], source: "the-odds-api" };
}

/** Adapt an ApiGame (OddsPapi / The Odds API) into the standard MatchView contract. */
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
export function clearBetsApiFeedCache(): void {
  cache = null;
}
