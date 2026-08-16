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

export type ApiScore = {
  externalId: string;
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
}

// ─────────────────────────────────────────────────────────────────────────
// The Odds API implementation (no SDK needed — plain fetch).
// Requires env: ODDS_API_KEY  (leave empty to keep using manual/seed games)
// ─────────────────────────────────────────────────────────────────────────

export class TheOddsApi implements OddsProvider {
  id = "the-odds-api";
  private base = "https://api.the-odds-api.com/v4";

  private async get(path: string) {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY is not set");
    const res = await fetch(`${this.base}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`);
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
      const data = (await this.get(
        `/sports/${encodeURIComponent(sportKey)}/odds?regions=${regions}&markets=h2h,totals&oddsFormat=decimal`
      )) as {
        id: string; commence_time: string; home_team: string; away_team: string;
        bookmakers: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
      }[];
      for (const ev of data) {
        const markets: ApiGame["markets"] = [];
        const bookmaker = ev.bookmakers[0];
        for (const m of bookmaker?.markets ?? []) {
          markets.push({
            key: m.key === "h2h" ? "MATCH_RESULT" : m.key === "totals" ? "OVER_UNDER" : m.key,
            name: m.key === "h2h" ? "Match Result" : m.key === "totals" ? "Over/Under" : m.key,
            outcomes: m.outcomes.map((o) => ({ name: o.name, odds: o.price })),
          });
        }
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
        id: string; completed: boolean; scores?: { name: string; score: string }[];
      }[];
      for (const ev of data) {
        const hs = ev.scores?.find((s) => s.name === "home")?.score;
        const as = ev.scores?.find((s) => s.name === "away")?.score;
        scores.push({
          externalId: ev.id,
          status: ev.completed ? "finished" : "live",
          homeScore: hs !== undefined ? Number(hs) : undefined,
          awayScore: as !== undefined ? Number(as) : undefined,
        });
      }
    }
    return scores;
  }
}
