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

/** The Odds API sport key → display league name ("soccer_epl" → "England - Premier League").
 *  Also used by the sync to stamp a league name on games (the Odds API odds
 *  payload has no per-game league name, only the sport key). */
export const LEAGUE_TITLES: Record<string, string> = {
  americanfootball_cfl: "CFL",
  americanfootball_ncaaf: "NCAAF",
  americanfootball_ncaaf_championship_winner: "NCAAF Championship Winner",
  americanfootball_ncaaf_fcs: "NCAAF FCS",
  americanfootball_nfl: "NFL",
  americanfootball_nfl_preseason: "NFL Preseason",
  americanfootball_nfl_super_bowl_winner: "NFL Super Bowl Winner",
  americanfootball_ufl: "UFL",
  aussierules_afl: "AFL",
  aussierules_aflw: "AFL Women's",
  baseball_kbo: "KBO",
  baseball_milb: "MiLB",
  baseball_mlb: "MLB",
  baseball_mlb_preseason: "MLB Preseason",
  baseball_mlb_world_series_winner: "MLB World Series Winner",
  baseball_ncaa: "NCAA Baseball",
  baseball_npb: "NPB",
  basketball_euroleague: "Basketball Euroleague",
  basketball_nba: "NBA",
  basketball_nba_all_stars: "NBA All Star",
  basketball_nba_championship_winner: "NBA Championship Winner",
  basketball_nba_preseason: "NBA Preseason",
  basketball_nba_summer_league: "NBA Summer League",
  basketball_nbl: "NBL",
  basketball_ncaab: "NCAAB",
  basketball_ncaab_championship_winner: "NCAAB Championship Winner",
  basketball_wnba: "WNBA",
  basketball_wncaab: "WNCAAB",
  boxing_boxing: "Boxing",
  cricket_asia_cup: "Asia Cup",
  cricket_big_bash: "Big Bash",
  cricket_caribbean_premier_league: "CPLT20",
  cricket_icc_trophy: "ICC Champions Trophy",
  cricket_icc_world_cup: "ICC World Cup",
  cricket_icc_world_cup_womens: "ICC Women's World Cup",
  cricket_international_t20: "International Twenty20",
  cricket_ipl: "IPL",
  cricket_odi: "One Day Internationals",
  cricket_psl: "Pakistan Super League",
  cricket_t20_blast: "T20 Blast",
  cricket_t20_world_cup: "T20 World Cup",
  cricket_t20_world_cup_womens: "T20 Women's World Cup",
  cricket_test_match: "Test Matches",
  cricket_the_hundred: "The Hundred",
  cricket_the_hundred_womens: "The Hundred - Women's",
  golf_masters_tournament_winner: "Masters Tournament Winner",
  golf_pga_championship_winner: "PGA Championship Winner",
  golf_the_open_championship_winner: "The Open Winner",
  golf_us_open_winner: "US Open Winner",
  handball_germany_bundesliga: "Handball-Bundesliga",
  icehockey_ahl: "AHL",
  icehockey_liiga: "Liiga",
  icehockey_mestis: "Mestis",
  icehockey_nhl: "NHL",
  icehockey_nhl_championship_winner: "NHL Championship Winner",
  icehockey_nhl_preseason: "NHL Preseason",
  icehockey_sweden_allsvenskan: "HockeyAllsvenskan",
  icehockey_sweden_hockey_league: "SHL",
  lacrosse_ncaa: "NCAA Lacrosse",
  lacrosse_pll: "PLL",
  mma_mixed_martial_arts: "MMA",
  politics_us_presidential_election_winner: "US Presidential Elections Winner",
  rugbyleague_nrl: "NRL",
  rugbyleague_nrl_state_of_origin: "State of Origin",
  rugbyleague_nrlw: "NRLW",
  rugbyunion_six_nations: "Six Nations",
  soccer_africa_cup_of_nations: "Africa Cup of Nations",
  soccer_argentina_primera_division: "Primera División - Argentina",
  soccer_australia_aleague: "A-League",
  soccer_austria_bundesliga: "Austrian Football Bundesliga",
  soccer_belgium_first_div: "Belgium First Div",
  soccer_brazil_campeonato: "Brazil - Serie A",
  soccer_brazil_serie_b: "Brazil Série B",
  soccer_chile_campeonato: "Primera División - Chile",
  soccer_china_superleague: "Super League - China",
  soccer_concacaf_gold_cup: "CONCACAF Gold Cup",
  soccer_concacaf_leagues_cup: "Leagues Cup",
  soccer_conmebol_copa_america: "Copa América",
  soccer_conmebol_copa_libertadores: "Copa Libertadores",
  soccer_conmebol_copa_sudamericana: "Copa Sudamericana",
  soccer_denmark_superliga: "Denmark Superliga",
  soccer_efl_champ: "England - Championship",
  soccer_england_efl_cup: "England - EFL Cup",
  soccer_england_league1: "England - League One",
  soccer_england_league2: "England - League Two",
  soccer_epl: "England - Premier League",
  soccer_fa_cup: "FA Cup",
  soccer_fifa_club_world_cup: "FIFA Club World Cup",
  soccer_fifa_world_cup: "FIFA World Cup",
  soccer_fifa_world_cup_qualifiers_europe: "FIFA World Cup Qualifiers - Europe",
  soccer_fifa_world_cup_qualifiers_south_america: "FIFA World Cup Qualifiers - South America",
  soccer_fifa_world_cup_winner: "FIFA World Cup Winner",
  soccer_fifa_world_cup_womens: "FIFA Women's World Cup",
  soccer_finland_veikkausliiga: "Veikkausliiga - Finland",
  soccer_france_coupe_de_france: "Coupe de France",
  soccer_france_ligue_one: "France - Ligue 1",
  soccer_france_ligue_two: "France - Ligue 2",
  soccer_germany_bundesliga: "Germany - Bundesliga",
  soccer_germany_bundesliga2: "Germany - Bundesliga 2",
  soccer_germany_bundesliga_women: "Frauen-Bundesliga",
  soccer_germany_dfb_pokal: "DFB-Pokal",
  soccer_germany_liga3: "3. Liga - Germany",
  soccer_greece_super_league: "Super League - Greece",
  soccer_italy_coppa_italia: "Coppa Italia",
  soccer_italy_serie_a: "Italy - Serie A",
  soccer_italy_serie_b: "Italy - Serie B",
  soccer_japan_j_league: "J League",
  soccer_korea_kleague1: "K League 1",
  soccer_league_of_ireland: "League of Ireland",
  soccer_mexico_ligamx: "Liga MX",
  soccer_netherlands_eredivisie: "Netherlands - Eredivisie",
  soccer_norway_eliteserien: "Eliteserien - Norway",
  soccer_poland_ekstraklasa: "Ekstraklasa - Poland",
  soccer_portugal_primeira_liga: "Portugal - Primeira Liga",
  soccer_russia_premier_league: "Premier League - Russia",
  soccer_saudi_arabia_pro_league: "Saudi Pro League",
  soccer_spain_copa_del_rey: "Copa del Rey",
  soccer_spain_la_liga: "Spain - La Liga",
  soccer_spain_segunda_division: "Spain - Segunda Division",
  soccer_spl: "Scotland - Premiership",
  soccer_sweden_allsvenskan: "Allsvenskan - Sweden",
  soccer_sweden_superettan: "Superettan - Sweden",
  soccer_switzerland_superleague: "Swiss Superleague",
  soccer_turkey_super_league: "Turkey - Super Lig",
  soccer_uefa_champs_league: "Europe - UEFA Champions League",
  soccer_uefa_champs_league_qualification: "Europe - UEFA Champions League Qualifiers",
  soccer_uefa_champs_league_women: "UEFA Champions League Women",
  soccer_uefa_euro_qualification: "UEFA Euro Qualification",
  soccer_uefa_europa_conference_league: "UEFA Europa Conference League",
  soccer_uefa_europa_league: "Europe - UEFA Europa League",
  soccer_uefa_european_championship: "UEFA Euro",
  soccer_uefa_nations_league: "Europe - UEFA Nations League",
  soccer_usa_mls: "USA - MLS",
  tennis_atp_aus_open_singles: "ATP Australian Open",
  tennis_atp_barcelona_open: "ATP Barcelona Open",
  tennis_atp_canadian_open: "ATP Canadian Open",
  tennis_atp_china_open: "ATP China Open",
  tennis_atp_cincinnati_open: "ATP Cincinnati Open",
  tennis_atp_dubai: "ATP Dubai",
  tennis_atp_french_open: "ATP French Open",
  tennis_atp_halle_open: "ATP Halle Open",
  tennis_atp_hamburg_open: "ATP Hamburg Open",
  tennis_atp_indian_wells: "ATP Indian Wells",
  tennis_atp_italian_open: "ATP Italian Open",
  tennis_atp_madrid_open: "ATP Madrid Open",
  tennis_atp_miami_open: "ATP Miami Open",
  tennis_atp_monte_carlo_masters: "ATP Monte-Carlo Masters",
  tennis_atp_munich: "ATP Munich",
  tennis_atp_paris_masters: "ATP Paris Masters",
  tennis_atp_qatar_open: "ATP Qatar Open",
  tennis_atp_queens_club_champ: "ATP Queen's Club Championships",
  tennis_atp_shanghai_masters: "ATP Shanghai Masters",
  tennis_atp_us_open: "ATP US Open",
  tennis_atp_washington_open: "ATP Washington Open",
  tennis_atp_wimbledon: "ATP Wimbledon",
  tennis_wta_aus_open_singles: "WTA Australian Open",
  tennis_wta_bad_homburg_open: "WTA Bad Homburg Open",
  tennis_wta_canadian_open: "WTA Canadian Open",
  tennis_wta_charleston_open: "WTA Charleston Open",
  tennis_wta_china_open: "WTA China Open",
  tennis_wta_cincinnati_open: "WTA Cincinnati Open",
  tennis_wta_dubai: "WTA Dubai Championships",
  tennis_wta_french_open: "WTA French Open",
  tennis_wta_german_open: "WTA German Open",
  tennis_wta_indian_wells: "WTA Indian Wells",
  tennis_wta_italian_open: "WTA Italian Open",
  tennis_wta_madrid_open: "WTA Madrid Open",
  tennis_wta_miami_open: "WTA Miami Open",
  tennis_wta_monterrey_open: "WTA Monterrey Open",
  tennis_wta_qatar_open: "WTA Qatar Open",
  tennis_wta_queens_club_champ: "WTA Queen's Club Championships",
  tennis_wta_strasbourg: "WTA Internationaux de Strasbourg",
  tennis_wta_stuttgart_open: "WTA Stuttgart Open",
  tennis_wta_us_open: "WTA US Open",
  tennis_wta_washington_open: "WTA Washington Open",
  tennis_wta_wimbledon: "WTA Wimbledon",
  tennis_wta_wuhan_open: "WTA Wuhan Open",
};

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
