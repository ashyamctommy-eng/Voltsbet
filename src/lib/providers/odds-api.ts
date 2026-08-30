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
 * Expanded market set — requested for every league on every pre-match call:
 *   h2h          1X2 (full time)
 *   h2h_h1/h2    first/second half 1X2
 *   totals        over/under (full time)
 *   totals_h1/h2  first/second half over/under
 *   spreads        handicap spreads (US sports; soccer often omits)
 *   correct_score correct score
 * The Odds API omits markets it has no prices for — the UI tabs render only
 * what comes back.
 */
export const ODDS_MARKETS = [
  "h2h",
  "spreads",
  "totals",
  "h2h_h1",
  "totals_h1",
  "h2h_h2",
  "totals_h2",
  "correct_score",
] as const;

/** Market key → local key + display name (derive totals line from outcomes). */
const MARKET_MAP: {
  key: (typeof ODDS_MARKETS)[number];
  local: string;
  name: string;
}[] = [
  { key: "h2h", local: "MATCH_RESULT", name: "Match Result" },
  { key: "h2h_h1", local: "HT_RESULT", name: "1st Half - Match Result" },
  { key: "h2h_h2", local: "2H_RESULT", name: "2nd Half - Match Result" },
  { key: "totals", local: "OVER_UNDER", name: "Over/Under" },
  { key: "totals_h1", local: "OVER_UNDER_1H", name: "1st Half - Over/Under" },
  { key: "totals_h2", local: "OVER_UNDER_2H", name: "2nd Half - Over/Under" },
  { key: "spreads", local: "SPREAD", name: "Spread" },
  { key: "correct_score", local: "CORRECT_SCORE", name: "Correct Score" },
];

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

  async fetchUpcomingGames(sportKeys: string[]) {
    const games: ApiGame[] = [];
    // Free tier serves US-region bookmakers only (regions=us); paid plans add
    // eu/uk/au. Configure via ODDS_API_REGIONS. Odds come as decimals either way.
    const regions = process.env.ODDS_API_REGIONS ?? "us";
    for (const sportKey of sportKeys) {
      const cacheKey = `${sportKey}:${regions}:${ODDS_MARKETS.join(",")}`;
      const hit = oddsCache.get(cacheKey);
      let data: {
        id: string; commence_time: string; home_team: string; away_team: string;
        bookmakers: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
      }[];
      if (hit && Date.now() - hit.at < ODDS_CACHE_TTL_MS) {
        data = hit.data as typeof data; // served from cache — 0 API cost
      } else {
        data = (await this.get(
          `/sports/${encodeURIComponent(sportKey)}/odds?regions=${regions}&markets=${ODDS_MARKETS.join(",")}&oddsFormat=decimal`
        )) as typeof data;
        oddsCache.set(cacheKey, { at: Date.now(), data });
      }
      const now = Date.now();
      for (const ev of data) {
        // Past-match filter (spec): a fixture that already kicked off is NOT
        // pre-match — it belongs on /live (the /scores pipeline owns started
        // games, creating rows from the scores feed when needed).
        if (new Date(ev.commence_time).getTime() <= now) continue;
        if (!ev.bookmakers?.length) continue; // unpriced league → no empty cards
        const markets: ApiGame["markets"] = [];
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
          markets.push({
            key: spec.local,
            name,
            outcomes: applyMarginGrid(
              m.outcomes.map((o) => ({ name: o.name, odds: o.price })),
              (await getSettings()).oddsMarginPercent,
            ),
          });
        }
        if (!markets.length) continue; // books exist but no requested prices → skip
        games.push({
          externalId: ev.id,
          sportKey,
          homeName: ev.home_team,
          awayName: ev.away_team,
          startAt: new Date(ev.commence_time),
          markets,
        });
      }
    }
    return games;
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
