/**
 * Odds-API.io (API-Football / api-sports.io) provider — v3.football.api-sports.io.
 *
 * Covers global + African football leagues with real-time in-play metadata and
 * full market availability (1X2, Double Chance, BTTS, Over/Under…) with no
 * region locks. Requires env: ODDS_API_IO_KEY  (free tier: 100 requests/day).
 *
 * Response mapping implemented per v3 docs:
 *   /fixtures → status.short (NS/1H/HT/2H/FT…), status.elapsed (minute),
 *               league.name, teams.home/away (+logos), goals
 *   /odds?date= → per-fixture bookmaker bet arrays (Match Winner, Double
 *               Chance, Both Teams Score, Goals Over/Under…)
 */
import { ApiGame, ApiScore, OddsProvider } from "./odds-api";
import { applyMarginGrid } from "../margin";
import { getSettings } from "../settings";

const BASE = "https://v3.football.api-sports.io";

/** Map API-Football fixture status shorts → local game status. */
function localStatus(short: string): ApiScore["status"] {
  switch (short) {
    case "FT": case "AET": case "PEN": return "finished";
    case "1H": case "2H": case "ET": case "BT": case "INT": case "LIVE": return "live";
    case "HT": return "live";
    case "PST": case "ABD": return "postponed";
    case "CANC": case "AWD": case "WO": return "cancelled";
    default: return "scheduled"; // NS, TBD, SUSP, …
  }
}

function periodLabel(short: string): string | undefined {
  switch (short) {
    case "1H": return "First Half";
    case "HT": return "Halftime";
    case "2H": return "Second Half";
    case "ET": return "Extra Time";
    case "BT": return "Break Time";
    case "PEN": return "Penalties";
    default: return undefined;
  }
}

/** Map API-Football bet names → local market keys. */
function mapBetName(name: string): { key: string; marketName: string } | null {
  const n = name.toLowerCase();
  if (n.includes("match winner") || n.includes("1x2") || n.includes("three way")) {
    return { key: "MATCH_RESULT", marketName: "Match Result" };
  }
  if (n.includes("double chance")) return { key: "DOUBLE_CHANCE", marketName: "Double Chance" };
  if (n.includes("both teams") || n.includes("btts")) return { key: "BTTS", marketName: "Both Teams To Score" };
  if (n.includes("over/under") || n.includes("goals over")) return { key: "OVER_UNDER", marketName: "Over/Under" };
  if (n.includes("draw no bet")) return { key: "DRAW_NO_BET", marketName: "Draw No Bet" };
  return null;
}

type BetValue = { value: string; odd: string };
type Bet = { id: number; name: string; values: BetValue[] };

export class ApiFootballProvider implements OddsProvider {
  id = "odds-api-io";

  private key: string;

  constructor() {
    this.key = process.env.ODDS_API_IO_KEY ?? "";
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.key) throw new Error("ODDS_API_IO_KEY is not set");
    const res = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": this.key } });
    if (!res.ok) throw new Error(`Odds-API.io ${res.status}: ${await res.text().catch(() => "")}`);
    const json = (await res.json()) as { response: T; errors?: unknown };
    if (Array.isArray(json.errors) && json.errors.length) {
      throw new Error(`Odds-API.io error: ${JSON.stringify(json.errors)}`);
    }
    return json.response;
  }

  private dateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  async fetchSports() {
    return [{ key: "football", name: "Football" }];
  }

  async fetchUpcomingGames(sportKeys: string[]) {
    if (!sportKeys.includes("football")) return [];
    const margin = (await getSettings()).oddsMarginPercent;

    // Upcoming window: today → +6 days. /fixtures?date= (1 req) + /odds?date= (1 req) per day.
    const games: ApiGame[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.now() + i * 86400_000);
      const fixtures = await this.get<Fixture[]>(`/fixtures?date=${this.dateStr(day)}&timezone=UTC`);
      if (!fixtures.length) continue;

      // One odds call per day covers every fixture that day (free-tier friendly)
      let oddsByFixture = new Map<number, Bet[]>();
      try {
        const odds = await this.get<OddsResponse[]>(`/odds?date=${this.dateStr(day)}`);
        oddsByFixture = new Map(odds.map((o) => [o.fixture.id, o.bookmakers?.[0]?.bets ?? []]));
      } catch {
        /* odds optional — game still imported without odds */
      }

      for (const f of fixtures) {
        const short = f.fixture.status.short;
        if (localStatus(short) !== "scheduled") continue; // upcoming only here

        const markets = this.buildMarkets(oddsByFixture.get(f.fixture.id) ?? [], f, margin);
        games.push({
          externalId: `apiio-${f.fixture.id}`,
          sportKey: "football",
          competitionName: f.league.name,
          homeName: f.teams.home.name ?? "Home",
          awayName: f.teams.away.name ?? "Away",
          startAt: new Date(f.fixture.date),
          markets,
        });
      }
    }
    return games;
  }

  async fetchLiveScores(sportKeys: string[]) {
    if (!sportKeys.includes("football")) return [];
    const fixtures = await this.get<Fixture[]>(`/fixtures?live=all`);
    return fixtures.map((f) => {
      const short = f.fixture.status.short;
      const status = localStatus(short);
      return {
        externalId: `apiio-${f.fixture.id}`,
        status,
        homeScore: f.goals.home ?? undefined,
        awayScore: f.goals.away ?? undefined,
        period: periodLabel(short),
        clock: short === "HT" ? undefined : f.fixture.status.elapsed ? `${f.fixture.status.elapsed}'` : undefined,
      };
    });
  }

  private buildMarkets(bets: Bet[], f: Fixture, margin: number): ApiGame["markets"] {
    const markets: ApiGame["markets"] = [];

    for (const bet of bets) {
      const mapped = mapBetName(bet.name);
      if (!mapped) continue;
      const values = bet.values;
      if (!values.length) continue;

      let outcomes: { name: string; label?: string; odds: number }[] = [];
      if (mapped.key === "MATCH_RESULT") {
        const [home, draw, away] = values;
        outcomes = [
          { name: f.teams.home.name ?? home.value, label: "1", odds: Number(home.odd) },
          { name: "Draw", label: "X", odds: Number(draw?.odd ?? 0) },
          { name: f.teams.away.name ?? away.value, label: "2", odds: Number(away.odd) },
        ].filter((o) => o.odds > 0);
      } else {
        outcomes = values.map((v) => ({
          name: v.value,
          odds: Number(v.odd),
        }));
      }

      if (!outcomes.length) continue;
      const priced = applyMarginGrid(outcomes, margin);
      markets.push({ key: mapped.key, name: mapped.marketName, outcomes: priced });
    }
    return markets;
  }
}

type Fixture = {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed: number | null };
  };
  league: { id: number; name: string; country: string };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
  goals: { home: number | null; away: number | null };
};

type OddsResponse = {
  fixture: { id: number };
  bookmakers?: { id: number; name: string; bets: Bet[] }[];
};
