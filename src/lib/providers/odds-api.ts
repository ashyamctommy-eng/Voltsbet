/**
 * Sports-data provider abstraction (spec §9, §47).
 *
 * The whole app talks to `fetchUpcomingGames()` / `fetchLiveScores()` —
 * never to a provider directly. The Odds API (v4) is the ONLY provider.
 *
 * ── The Odds API (the-odds-api.com) ────────────────────────────────────
 * Sign up: https://the-odds-api.com  →  key emailed to you, no card needed.
 *   GET /v4/sports/            — list of supported sports
 *   GET /v4/sports/{key}/odds?regions=eu&markets=h2h,spreads,totals,h2h_h1,
 *                              totals_h1,h2h_h2,totals_h2,correct_score
 *   GET /v4/sports/{key}/scores?daysFrom=1   — live + finished (live pipeline)
 * Docs: https://the-odds-api.com/liveapi/guides/v4/
 */
export type ApiGame = {
  externalId: string;
  sportKey: string; // provider sport key, e.g. "soccer_epl"
  competitionName?: string;
  homeName: string;
  awayName: string;
  startAt: Date;
  /** True when the event already kicked off — the /odds endpoint returns
   *  in-play events with live-updating prices, and the sync layer refreshes
   *  existing live games' market odds from them (never creates rows). */
  inPlay?: boolean;
  markets: {
    key: string; // h2h | spreads | totals | correct_score | h2h_h1 …
    name: string;
    outcomes: { name: string; label?: string; odds: number }[];
  }[];
};

export type ApiScore = {
  externalId: string;
  status: "live" | "finished" | "cancelled" | "postponed" | "scheduled";
  homeScore?: number;
  awayScore?: number;
  period?: string;
  clock?: string;
  /** Event metadata carried by /scores — used to create DB rows for events
   *  the pre-match sync never ingested. */
  sportKey?: string;
  homeName?: string;
  awayName?: string;
  startAt?: Date;
};

export interface OddsProvider {
  id: string; // "the-odds-api"
  fetchSports(): Promise<{ key: string; name: string }[]>;
  fetchUpcomingGames(sportKeys: string[]): Promise<ApiGame[]>;
  fetchLiveScores(sportKeys: string[]): Promise<ApiScore[]>;
}

// ─────────────────────────────────────────────────────────────────────────
// The Odds API implementation (no SDK needed — plain fetch).
// Requires env: ODDS_API_KEY  (leave empty to keep using manual/seed games)
// ─────────────────────────────────────────────────────────────────────────

import { applyMarginGrid } from "../margin";
import { fetchOddsRetry } from "@/lib/odds-throttle";
import { getSettings } from "../settings";

/**
 * In-memory response cache for pre-match odds — responses are effectively
 * immutable within a 30–60 min window, so repeated syncs, admin syncs and
 * cold-bootstraps share ONE API request per league instead of burning quota.
 * TTL configurable via ODDS_API_CACHE_TTL_SECONDS (default 1800 = 30 min).
 */
const oddsCache = new Map<string, { at: number; data: unknown }>();
const ODDS_CACHE_TTL_MS = (Number(process.env.ODDS_API_CACHE_TTL_SECONDS) || 30 * 60) * 1000;

/**
 * Markets the /odds LIST endpoint can serve. Everything else in
 * ODDS_API_MARKETS is routed to the per-event endpoint
 * (/events/{id}/odds, via ODDS_API_EVENT_BOOKMAKERS) — verified 2026-08-31
 * that Pinnacle serves btts, double_chance, draw_no_bet and correct_score
 * that way (the list endpoint 422s on them).
 */
export const LIST_MARKETS = ["h2h", "spreads", "totals"] as const;

/**
 * Market set for the /odds LIST endpoint — per The Odds API v4 docs the list
 * endpoint only serves the featured markets (`h2h`, `spreads`, `totals`,
 * `outrights`; betting exchanges additionally return `h2h_lay`). Requesting
 * anything else (e.g. `correct_score`, `h2h_h1`) 422s the whole call.
 *
 * Markets beyond the list-supported three are fetched per event via
 * `/events/{id}/odds` (see `fetchEventMarkets`) — that is where btts,
 * double_chance, draw_no_bet and correct_score actually live, served by a
 * limited set of bookmakers (Pinnacle confirmed). The sync degrades
 * gracefully: unsupported markets are dropped with a one-retry fallback,
 * and events where the chosen bookmakers return no data are skipped, so a
 * partial market set never breaks a league.
 *
 * Override via ODDS_API_MARKETS (comma-separated) — e.g. add `h2h_h1,
 * totals_h1, h2h_h2, totals_h2` for half-time markets when bookmaker
 * coverage exists — the UI renders any market key that comes back.
 */
export const ODDS_MARKETS = (
  process.env.ODDS_API_MARKETS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
    "h2h",
    "spreads",
    "totals",
    "btts",
    "double_chance",
    "draw_no_bet",
    "correct_score",
    "alternate_spreads",
    "alternate_totals",
    "h2h_h1",
    "totals_h1",
    "spreads_h1",
    "h2h_h2",
    "totals_h2",
    "spreads_h2",
    "total_corners",
    "total_bookings",
    // "player_props" — supported via MARKET_MAP but NOT requested by default
    // (heaviest quota consumers on the extended endpoint; enable per league
    // with ODDS_API_MARKETS=...,player_props when the product needs them).
  ]
) as readonly string[];

/** Market key → local key + display name (derive totals line from outcomes). */
const MARKET_MAP: {
  key: string;
  local: string;
  name: string;
}[] = [
  { key: "h2h", local: "MATCH_RESULT", name: "Match Result" },
  { key: "h2h_h1", local: "HT_RESULT", name: "1st Half - Match Result" },
  { key: "h2h_h2", local: "2H_RESULT", name: "2nd Half - Match Result" },
  { key: "totals", local: "OVER_UNDER", name: "Over/Under" },
  { key: "totals_h1", local: "OVER_UNDER_1H", name: "1st Half - Over/Under" },
  { key: "totals_h2", local: "OVER_UNDER_2H", name: "2nd Half - Over/Under" },
  { key: "spreads", local: "SPREAD", name: "Handicap" },
  { key: "spreads_h1", local: "SPREAD_1H", name: "1st Half Handicap" },
  { key: "spreads_h2", local: "SPREAD_2H", name: "2nd Half Handicap" },
  { key: "alternate_spreads", local: "ALTERNATE_SPREAD", name: "Alternate Handicaps" },
  { key: "alternate_totals", local: "ALTERNATE_TOTALS", name: "Alternate Totals" },
  { key: "correct_score", local: "CORRECT_SCORE", name: "Correct Score" },
  { key: "btts", local: "BTTS", name: "Both Teams to Score" },
  { key: "double_chance", local: "DOUBLE_CHANCE", name: "Double Chance" },
  { key: "draw_no_bet", local: "DRAW_NO_BET", name: "Draw No Bet" },
  { key: "total_corners", local: "TOTAL_CORNERS", name: "Total Corners" },
  { key: "total_bookings", local: "TOTAL_BOOKINGS", name: "Total Cards/Bookings" },
  { key: "player_props", local: "PLAYER_PROPS", name: "Player Props" },
];

/**
 * Normalize provider outcome names to the local market conventions the
 * settlement engine + bet slip expect:
 *   correct_score "Aston Villa:0|Arsenal:1" → "0-1" (home-away)
 *   double_chance "Arsenal or Draw"        → "1X" / "X2" / "12"
 *   draw_no_bet   team names stay, label becomes "1"/"2"
 *   btts "Yes"/"No" and totals/HT names pass through.
 */
function normalizeOutcomeName(
  localKey: string,
  name: string,
  homeName: string,
  awayName: string,
): { name: string; label?: string } {
  if (localKey === "CORRECT_SCORE") {
    // "Home:2|Away:1" → "2-1" (home score first, regardless of team names)
    const m = name.match(/:(\d+)\|.*:(\d+)/);
    if (m) return { name: `${m[1]}-${m[2]}` };
    return { name };
  }
  if (localKey === "DOUBLE_CHANCE") {
    const n = name.toLowerCase();
    const home = homeName.toLowerCase();
    const away = awayName.toLowerCase();
    if (n.includes(`${home} or draw`) || n.includes(`${away} or draw`)) {
      return { name: n.includes(`${home} or draw`) ? "1X" : "X2" };
    }
    if (n.includes(`${home} or ${away}`) || n.includes(`${away} or ${home}`)) return { name: "12" };
    return { name };
  }
  if (localKey === "DRAW_NO_BET") {
    const n = name.toLowerCase();
    if (n === homeName.toLowerCase()) return { name, label: "1" };
    if (n === awayName.toLowerCase()) return { name, label: "2" };
    return { name };
  }
  return { name };
}

/** Derive a totals-style display name from the outcomes (e.g. "Over/Under 2.5"). */
function totalsName(outcomes: { name: string; price: number }[], fallback: string): string {
  const over = outcomes.find((o) => o.name.toLowerCase().startsWith("over"));
  const line = over?.name.trim().replace(/^over\s+/i, "");
  return line ? `${fallback} ${line}` : fallback;
}

/**
 * Estimate the match minute from the kickoff time. The Odds API does NOT
 * expose a match clock (unlike the old BetsAPI timer) — this derives an
 * approximation from elapsed wall-clock time, clamped to a football window
 * (45+15+45). Live cards show the estimate with a tick; the authoritative
 * source remains the /scores `completed` flag + scores.
 */
export function estimateClock(startAt: Date): { clock: string; period: string } {
  const mins = Math.floor((Date.now() - startAt.getTime()) / 60_000);
  if (mins <= 45) return { clock: `${Math.max(0, mins)}'`, period: "1H" };
  if (mins <= 60) return { clock: "HT", period: "HT" };
  if (mins <= 105) return { clock: `${mins - 60 + 45}'`, period: "2H" };
  return { clock: `${Math.min(mins - 105 + 90, 120)}'`, period: "2H" };
}

export class TheOddsApi implements OddsProvider {
  id = "the-odds-api";
  private base = "https://api.the-odds-api.com/v4";

  private async get(path: string) {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY is not set");
    const url = `${this.base}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`;
    // Throttled + 429-retry: the free tier allows 1 request/second and the
    // sync fires many requests back-to-back.
    const res = await fetchOddsRetry(url);
    if (!res.ok) throw new Error(`The Odds API ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json();
  }

  async fetchSports() {
    const data = (await this.get("/sports")) as { key: string; title: string; active: boolean }[];
    return data.filter((s) => s.active).map((s) => ({ key: s.key, name: s.title }));
  }

  /**
   * Fetch odds for a league, degrading gracefully when the API rejects a
   * requested market. The /odds list endpoint only supports the featured
   * markets; if ODDS_API_MARKETS includes an unsupported one the API answers
   * 422 with the offenders in the message — retry once with them removed so
   * a partial market set never breaks a league. (Error responses cost 0.)
   */
  private async requestOdds(sportKey: string, regions: string, markets: readonly string[]) {
    const attempt = async (ms: readonly string[]) =>
      (await this.get(
        `/sports/${encodeURIComponent(sportKey)}/odds?regions=${regions}&markets=${ms.join(",")}&oddsFormat=decimal`
      )) as {
        id: string; commence_time: string; home_team: string; away_team: string;
        bookmakers: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
      }[];

    try {
      return await attempt(markets);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // e.g. "The Odds API 422: Markets not supported by this endpoint: correct_score, h2h_h1"
      // or   "The Odds API 422: Invalid markets: team_total_goals"
      const m = msg.match(/422:.*?(?:Markets not supported by this endpoint|Invalid markets):\s*([a-z0-9_,\s]+)/i);
      if (!m || !m[1]) throw e; // not a market-validation error — rethrow
      const unsupported = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      const supported = markets.filter((k) => !unsupported.includes(k));
      if (!supported.length || supported.length === markets.length) throw e;
      console.warn(`[odds-api] ${sportKey}: dropping unsupported markets (${unsupported.join(", ")}) and retrying with [${supported.join(", ")}]`);
      return await attempt(supported);
    }
  }

  async fetchUpcomingGames(sportKeys: string[], markets: readonly string[] = ODDS_MARKETS) {
    const games: ApiGame[] = [];
    // Free tier serves US-region bookmakers only (regions=us); paid plans add
    // eu/uk/au. Configure via ODDS_API_REGIONS. Odds come as decimals either way.
    const regions = process.env.ODDS_API_REGIONS ?? "us";
    // The list endpoint 422s on anything beyond the featured markets — the
    // extended set (btts, correct_score, …) is fetched per event instead.
    const listMarkets = markets.filter((m) => (LIST_MARKETS as readonly string[]).includes(m));
    if (!listMarkets.length) return games;
    for (const sportKey of sportKeys) {
      const cacheKey = `${sportKey}:${regions}:${listMarkets.join(",")}`;
      const hit = oddsCache.get(cacheKey);
      let data: {
        id: string; commence_time: string; home_team: string; away_team: string;
        bookmakers: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
      }[];
      if (hit && Date.now() - hit.at < ODDS_CACHE_TTL_MS) {
        data = hit.data as typeof data; // served from cache — 0 API cost
      } else {
        data = await this.requestOdds(sportKey, regions, listMarkets);
        oddsCache.set(cacheKey, { at: Date.now(), data });
      }
      const now = Date.now();
      for (const ev of data) {
        if (!ev.bookmakers?.length) continue; // unpriced league → no empty cards
        const inPlay = new Date(ev.commence_time).getTime() <= now;
        // Past-completed events are never returned by /odds; in-play events
        // carry live prices and are passed through so the sync layer can
        // refresh existing live games' odds (it never creates rows for them).
        const markets_: ApiGame["markets"] = [];
        // Aggregate across bookmakers: for each requested market take the FIRST
        // book that offers it (bookmakers[0] alone silently drops markets).
        for (const spec of MARKET_MAP) {
          const book = ev.bookmakers.find((b) => b.markets.some((m) => m.key === spec.key));
          const m = book?.markets.find((m) => m.key === spec.key);
          if (!m?.outcomes?.length) continue;
          const name =
            spec.local.startsWith("OVER_UNDER")
              ? totalsName(m.outcomes, spec.name)
              : spec.name;
          markets_.push({
            key: spec.local,
            name,
            outcomes: applyMarginGrid(
              m.outcomes.map((o) => ({ name: o.name, odds: o.price })),
              (await getSettings()).oddsMarginPercent,
            ),
          });
        }
        if (!markets_.length) continue; // books exist but no requested prices → skip
        games.push({
          externalId: ev.id,
          sportKey,
          inPlay,
          homeName: ev.home_team,
          awayName: ev.away_team,
          startAt: new Date(ev.commence_time),
          markets: markets_,
        });
      }
    }
    return games;
  }

  /**
   * Fetch extended markets per event via `/events/{id}/odds` (the ONLY place
   * btts / double_chance / draw_no_bet / correct_score / half-time lines are
   * served). Requires explicit `bookmakers` (regions alone returns nothing —
   * verified 2026-08-31; Pinnacle confirmed for soccer). 1 credit per market
   * per event. Events with no data are skipped silently; an empty markets
   * list returns [] without calling the API.
   */
  async fetchEventMarkets(
    events: { sportKey: string; eventId: string; homeName: string; awayName: string }[],
    markets: readonly string[],
  ): Promise<ApiGame[]> {
    const extended = markets.filter((m) => !(LIST_MARKETS as readonly string[]).includes(m));
    if (!extended.length || !events.length) return [];
    // Bovada primary (deepest event-pass board — audit 2026-08-31: 10 keys /
    // 51-52 lines per EPL fixture incl. 20-line alternate spreads), Pinnacle
    // as the fallback book for markets Bovada doesn't serve (e.g. correct
    // score). Response order follows the param order, so bovada prices win
    // where both books serve a market. Override via ODDS_API_EVENT_BOOKMAKERS.
    const bookmakers = process.env.ODDS_API_EVENT_BOOKMAKERS ?? "bovada,pinnacle";
    const out: ApiGame[] = [];
    for (const ev of events) {
      const cacheKey = `ev:${ev.eventId}:${bookmakers}:${extended.join(",")}`;
      const hit = oddsCache.get(cacheKey);
      let data: {
        id: string; sport_key: string; commence_time: string; home_team: string; away_team: string;
        bookmakers: { key: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
      }[];
      if (hit && Date.now() - hit.at < ODDS_CACHE_TTL_MS) {
        data = hit.data as typeof data;
      } else {
        // NOTE: /events/{id}/odds returns ONE event object (not an array).
        // Graceful market degradation: if the API rejects some configured
        // markets (422 INVALID_MARKET — e.g. a key added to ODDS_API_MARKETS
        // that the provider doesn't serve), drop exactly those and retry
        // once. A bad key must never take the whole sync down.
        let requestMarkets = extended;
        try {
          const raw = (await this.get(
            `/sports/${encodeURIComponent(ev.sportKey)}/events/${encodeURIComponent(ev.eventId)}/odds?bookmakers=${encodeURIComponent(bookmakers)}&markets=${requestMarkets.join(",")}&oddsFormat=decimal`
          )) as (typeof data)[number] | null | (typeof data)[number][];
          data = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          const m = msg.match(/Invalid markets: ([^\]]+)/i);
          if (m) {
            const invalid = new Set(m[1].split(",").map((x) => x.trim()));
            requestMarkets = extended.filter((k) => !invalid.has(k));
            if (!requestMarkets.length) throw e;
            const raw = (await this.get(
              `/sports/${encodeURIComponent(ev.sportKey)}/events/${encodeURIComponent(ev.eventId)}/odds?bookmakers=${encodeURIComponent(bookmakers)}&markets=${requestMarkets.join(",")}&oddsFormat=decimal`
            )) as (typeof data)[number] | null | (typeof data)[number][];
            data = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
          } else {
            throw e;
          }
        }
        oddsCache.set(cacheKey, { at: Date.now(), data });
      }
      if (!data?.length) continue; // no bookmaker served these markets → skip

      const marketsOut: ApiGame["markets"] = [];
      for (const spec of MARKET_MAP) {
        if (!extended.includes(spec.key)) continue;
        const book = data[0].bookmakers.find((b) => b.markets.some((m) => m.key === spec.key));
        const m = book?.markets.find((m) => m.key === spec.key);
        if (!m?.outcomes?.length) continue;
        const name =
          spec.local.startsWith("OVER_UNDER")
            ? totalsName(m.outcomes, spec.name)
            : spec.name;
        // Margin first (names survive unchanged), then normalize names/labels
        // to the local conventions the settlement engine expects.
        const priced = applyMarginGrid(
          m.outcomes.map((o) => ({ name: o.name, odds: o.price })),
          (await getSettings()).oddsMarginPercent,
        );
        marketsOut.push({
          key: spec.local,
          name,
          outcomes: priced.map((o) => {
            const norm = normalizeOutcomeName(spec.local, o.name, ev.homeName, ev.awayName);
            return { name: norm.name, label: norm.label, odds: o.odds };
          }),
        });
      }
      if (!marketsOut.length) continue;
      out.push({
        externalId: ev.eventId,
        sportKey: ev.sportKey,
        homeName: ev.homeName,
        awayName: ev.awayName,
        startAt: new Date(data[0].commence_time),
        markets: marketsOut,
      });
    }
    return out;
  }

  async fetchLiveScores(sportKeys: string[]) {
    const scores: ApiScore[] = [];
    for (const sportKey of sportKeys) {
      const data = (await this.get(`/sports/${encodeURIComponent(sportKey)}/scores?daysFrom=1`)) as {
        id: string; sport_key: string; commence_time: string; completed: boolean;
        home_team: string; away_team: string;
        scores?: { name: string; score: string }[] | null;
      }[];
      for (const ev of data) {
        // /scores reports scores by TEAM NAME (not "home"/"away") — match them
        // to the fixture's participants. Upcoming (not started) games have
        // scores:null and must NOT be marked live.
        const hs = ev.scores?.find((s) => s.name === ev.home_team)?.score;
        const as = ev.scores?.find((s) => s.name === ev.away_team)?.score;
        const started = !!ev.scores;
        const startAt = new Date(ev.commence_time);
        const { clock, period } = estimateClock(startAt);
        scores.push({
          externalId: ev.id,
          sportKey: ev.sport_key,
          homeName: ev.home_team,
          awayName: ev.away_team,
          startAt,
          status: ev.completed ? "finished" : started ? "live" : "scheduled",
          homeScore: hs !== undefined ? Number(hs) : undefined,
          awayScore: as !== undefined ? Number(as) : undefined,
          period,
          clock,
        });
      }
    }
    return scores;
  }
}
