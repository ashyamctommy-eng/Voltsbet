/**
 * Sports-data provider abstraction (spec §9, §47).
 *
 * The whole app talks to `fetchUpcomingGames()` / `fetchLiveScores()` /
 * `applyGames()` — never to a provider directly. To switch from The Odds API
 * to Sportmonks or anything else, implement the same interface in a new file
 * and swap the import in src/lib/sync.ts. Nothing else changes.
 *
 * ── The Odds API (recommended starter — free 500 req/month) ──────────────
 * Sign up: https://the-odds-api.com  →  key emailed to you, no card needed.
 *   GET /v4/sports/            — list of supported sports
 *   GET /v4/sports/{key}/odds?regions=eu&markets=h2h,spreads,totals
 *   GET /v4/sports/{key}/scores?daysFrom=1
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
    key: string; // h2h | spreads | totals | outrights …
    name: string;
    outcomes: { name: string; label?: string; odds: number }[];
  }[];
};

export type ApiScore = {  externalId: string;
  status: "live" | "finished" | "cancelled" | "postponed" | "scheduled";
  homeScore?: number;
  awayScore?: number;
  period?: string;
  clock?: string;
};

export interface OddsProvider {
  id: string; // "the-odds-api" | "sportmonks" | …
  fetchSports(): Promise<{ key: string; name: string }[]>;
  fetchUpcomingGames(sportKeys: string[]): Promise<ApiGame[]>;
  fetchLiveScores(sportKeys: string[]): Promise<ApiScore[]>;
  /** Optional: finished outcomes for the given external ids (settlement). */
  fetchResults?(externalIds: string[]): Promise<ApiScore[]>;
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

export class TheOddsApi implements OddsProvider {
  id = "the-odds-api";
  private base = "https://api.the-odds-api.com/v4";

  private async get(path: string) {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY is not set");
    const url = `${this.base}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`;
    // Throttled + 429-retry: the free tier allows 1 request/second and the
    // sync fires 44 requests back-to-back (22 leagues × h2h,totals).
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
      // h2h = moneyline; totals = over/under. One request per sport per market.
      const cacheKey = `${sportKey}:${regions}`;
      const hit = oddsCache.get(cacheKey);
      let data: {
        id: string; commence_time: string; home_team: string; away_team: string;
        bookmakers: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
      }[];
      if (hit && Date.now() - hit.at < ODDS_CACHE_TTL_MS) {
        data = hit.data as typeof data; // served from cache — 0 API cost
      } else {
        data = (await this.get(
          `/sports/${encodeURIComponent(sportKey)}/odds?regions=${regions}&markets=h2h,totals&oddsFormat=decimal`
        )) as typeof data;
        oddsCache.set(cacheKey, { at: Date.now(), data });
      }
      // Unpriced-league filter: leagues with NO active US-book prices (Saudi
      // Pro League, African leagues on the free tier) return 0 bookmakers —
      // skip them entirely so no empty cards / suspended overlays ever render.
      for (const ev of data) {
        if (!ev.bookmakers?.length) continue;
        const markets: ApiGame["markets"] = [];
        // Aggregate across bookmakers: for each requested market take the FIRST
        // book that offers it. bookmakers[0] alone silently drops markets —
        // e.g. FanDuel lists h2h only while totals sits at other books
        // (verified live 2026-08-25: Valencia v Real Betis, 8 books).
        for (const key of ["h2h", "totals"] as const) {
          const book = ev.bookmakers.find((b) => b.markets.some((m) => m.key === key));
          const m = book?.markets.find((m) => m.key === key);
          if (!m?.outcomes?.length) continue;
          markets.push({
            key: key === "h2h" ? "MATCH_RESULT" : key === "totals" ? "OVER_UNDER" : key,
            name: key === "h2h" ? "Match Result" : key === "totals" ? "Over/Under" : key,
            outcomes: applyMarginGrid(
              m.outcomes.map((o) => ({ name: o.name, odds: o.price })),
              (await getSettings()).oddsMarginPercent,
            ),
          });
        }
        if (!markets.length) continue; // books exist but no h2h/totals prices → skip
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
        id: string; completed: boolean; home_team: string; away_team: string;
        scores?: { name: string; score: string }[] | null;
      }[];
      for (const ev of data) {
        // /scores reports scores by TEAM NAME (not "home"/"away") — match them
        // to the fixture's participants. Upcoming (not started) games have
        // scores:null and must NOT be marked live.
        const hs = ev.scores?.find((s) => s.name === ev.home_team)?.score;
        const as = ev.scores?.find((s) => s.name === ev.away_team)?.score;
        scores.push({
          externalId: ev.id,
          status: ev.completed ? "finished" : ev.scores ? "live" : "scheduled",
          homeScore: hs !== undefined ? Number(hs) : undefined,
          awayScore: as !== undefined ? Number(as) : undefined,
        });
      }
    }
    return scores;
  }
}
