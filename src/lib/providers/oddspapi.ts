/**
 * OddspapiProvider — OddsPapi v4 (https://oddspapi.io) as an OddsProvider.
 *
 * Real-time odds aggregator: 300+ bookmakers, 60+ sports, REST + low-latency
 * WebSocket feed. Auth = `apiKey` query param (env ODDSPAPI_KEY).
 *
 * ── Endpoints (verified against https://oddspapi.io/us/docs) ─────────────
 *   GET /v4/markets                 → market id → name/type/handicap/outcomes
 *                                     (101 = Full Time Result 1X2, 104 = BTTS,
 *                                      106 = Over/Under; sportId 10 = soccer)
 *   GET /v4/fixtures                → fixtures WITH team names + tournaments;
 *                                     filters: statusId (0 prematch / 1 live /
 *                                     2 finished / 3 cancelled), from/to
 *                                     (≤10 days apart), hasOdds, bookmakers
 *   GET /v4/odds-by-tournaments     → BATCH odds for N tournaments, 1 request
 *                                     (participant ids only — merge by
 *                                     fixtureId with the fixtures call)
 *   GET /v4/scores                  → per-fixture period scores (1 req each)
 *   GET /v4/account                 → subscription + quota (always free)
 *
 * ── Budget ──────────────────────────────────────────────────────────────
 * Every billable call = 1 request against the monthly plan allowance
 * (free plan included). Pre-match sync = markets (cached 24h, 1 req) +
 * fixtures (1 req) + odds-by-tournaments (1 req) = 3 requests, then 2 per
 * refresh. Live scores cost 1 request per fixture (capped
 * ODDS_PAPI_LIVE_SCORES, default 10). Check /v4/account for remaining quota.
 */
import { ApiGame, ApiScore, OddsProvider } from "./odds-api";
import { applyMarginGrid } from "../margin";
import { getSettings } from "../settings";

const SOCCER = "10";
const BASE = "https://api.oddspapi.io/v4";

/** Default league categories (matches the curated board; env override). */
const DEFAULT_CATEGORIES = [
  "england", "spain", "italy", "germany", "france", "portugal", "netherlands",
  "belgium", "scotland", "turkey", "brazil", "argentina", "south africa",
  "egypt", "nigeria", "ghana", "tanzania", "uganda", "zimbabwe", "tunisia",
  "algeria", "angola", "mozambique", "malawi", "africa", "uefa", "europe",
].join(",");

type OddspapiFixture = {
  fixtureId: string;
  participant1Id: number;
  participant2Id: number;
  sportId: number;
  tournamentId: number;
  statusId: number;
  hasOdds: boolean;
  startTime: string;
  statusName: string;
  participant1Name: string;
  participant2Name: string;
  categoryName: string;
  tournamentName: string;
};

type OddsOutcome = {
  players: { [k: string]: { active?: boolean; price?: number; bookmakerOutcomeId?: string; limit?: number } };
};

type OddspapiOddsFixture = {
  fixtureId: string;
  participant1Id: number;
  participant2Id: number;
  tournamentId: number;
  statusId: number;
  startTime: string;
  bookmakerOdds: { [bookmaker: string]: { bookmakerIsActive?: boolean; suspended?: boolean; markets: { [id: string]: { marketActive?: boolean; outcomes: { [id: string]: OddsOutcome } } } } };
};

type MarketDef = {
  marketId: number;
  marketName: string;
  marketType: string;
  handicap: number;
  period: string;
  playerProp: boolean;
  sportId?: number;
  outcomes: { outcomeId: number; outcomeName: string }[];
};

/** Thin GET client — apiKey query param, 429 surfacing. */
class OddspapiClient {
  constructor(private readonly key: string) {}

  async get<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const url = new URL(BASE + path);
    url.searchParams.set("apiKey", this.key);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error(`OddsPapi quota exceeded: ${body.slice(0, 160)}`);
      throw new Error(`OddsPapi HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Subscription + remaining quota — unmetered per the docs. */
  async account(): Promise<{ request_limit?: number; request_count?: number; plan?: string }> {
    try {
      return await this.get("/account");
    } catch {
      return {};
    }
  }
}

let marketsCache: { at: number; map: Map<number, MarketDef> } | null = null;

async function getMarkets(client: OddspapiClient): Promise<Map<number, MarketDef>> {
  if (marketsCache && Date.now() - marketsCache.at < 24 * 3600_000) return marketsCache.map;
  const all = await client.get<MarketDef[]>("/markets", { language: "en" });
  const map = new Map(all.filter((m) => m.sportId === Number(SOCCER)).map((m) => [m.marketId, m]));
  marketsCache = { at: Date.now(), map };
  return map;
}

/** Price the listed outcomes; missing legs stay 0 so the UI renders "-". */
function priceOutcomes(
  outcomes: { name: string; label?: string; odds: number }[],
  margin: number,
): { name: string; label?: string; odds: number }[] {
  const present = outcomes.filter((o) => o.odds > 1);
  if (present.length < 2) {
    return outcomes.map((o) => ({ name: o.name, label: o.label, odds: o.odds > 1 ? Math.round(o.odds * 20) / 20 : 0 }));
  }
  const repriced = applyMarginGrid(present, margin);
  let i = 0;
  return outcomes.map((o) =>
    o.odds > 1 ? { ...repriced[i++], label: o.label } : { name: o.name, label: o.label, odds: 0 },
  );
}

/** Map a fixture's bookmaker markets onto our market model. */
function extractMarkets(
  od: OddspapiOddsFixture,
  bookmaker: string,
  markets: Map<number, MarketDef>,
  homeName: string,
  awayName: string,
  margin: number,
): ApiGame["markets"] {
  const bm = od.bookmakerOdds?.[bookmaker];
  if (!bm || bm.suspended || !bm.markets) return [];
  const out: ApiGame["markets"] = [];
  const price = (o: OddsOutcome) => {
    const p = o.players?.["0"];
    if (!p || p.active === false || !p.price || p.price <= 1) return 0;
    return p.price;
  };

  // Collect totals lines first (pick nearest 2.5 afterwards).
  let bestLine = -1;
  let bestOver = 0;
  let bestUnder = 0;
  const totalsCandidates: { line: number; over: number; under: number }[] = [];

  for (const [marketIdStr, md] of Object.entries(bm.markets)) {
    const def = markets.get(Number(marketIdStr));
    if (!def || def.playerProp || md.marketActive === false) continue;
    if (def.period !== "fulltime" && !(def.period === "firsthalf" && def.marketType === "1x2")) continue;

    const outcomeName = (oid: string | number) => def.outcomes.find((o) => o.outcomeId === Number(oid))?.outcomeName ?? "";
    const oddsFor = (names: string[]) => {
      for (const [oid, oc] of Object.entries(md.outcomes)) {
        if (names.includes(outcomeName(oid).toLowerCase())) {
          const p = price(oc);
          if (p > 0) return p;
        }
      }
      return 0;
    };

    if (def.marketType === "1x2" && def.period === "fulltime") {
      out.push({
        key: "MATCH_RESULT",
        name: "Match Result",
        outcomes: priceOutcomes(
          [
            { name: homeName, label: "1", odds: oddsFor(["1"]) },
            { name: "Draw", label: "X", odds: oddsFor(["x", "draw"]) },
            { name: awayName, label: "2", odds: oddsFor(["2"]) },
          ],
          margin,
        ),
      });
    } else if (def.marketType === "1x2" && def.period === "firsthalf") {
      out.push({
        key: "HT_RESULT",
        name: "Half-Time Result",
        outcomes: priceOutcomes(
          [
            { name: homeName, label: "1", odds: oddsFor(["1"]) },
            { name: "Draw", label: "X", odds: oddsFor(["x", "draw"]) },
            { name: awayName, label: "2", odds: oddsFor(["2"]) },
          ],
          margin,
        ),
      });
    } else if (/both teams to score/i.test(def.marketName)) {
      out.push({
        key: "BTTS",
        name: "Both Teams To Score",
        outcomes: priceOutcomes(
          [
            { name: "yes", odds: oddsFor(["yes"]) },
            { name: "no", odds: oddsFor(["no"]) },
          ],
          margin,
        ),
      });
    } else if (/draw no bet/i.test(def.marketName)) {
      out.push({
        key: "DRAW_NO_BET",
        name: "Draw No Bet",
        outcomes: priceOutcomes(
          [
            { name: homeName, label: "1", odds: oddsFor(["1"]) },
            { name: awayName, label: "2", odds: oddsFor(["2"]) },
          ],
          margin,
        ),
      });
    } else if (/over under/i.test(def.marketName) && def.marketType === "totals") {
      const over = oddsFor(["over"]);
      const under = oddsFor(["under"]);
      if (over > 0 && under > 0) {
        totalsCandidates.push({ line: def.handicap, over, under });
        if (bestLine < 0 || Math.abs(def.handicap - 2.5) < Math.abs(bestLine - 2.5)) {
          bestLine = def.handicap;
          bestOver = over;
          bestUnder = under;
        }
      }
    }
  }

  if (bestLine > 0) {
    out.push({
      key: "OVER_UNDER",
      name: `Over/Under ${bestLine}`,
      outcomes: priceOutcomes(
        [
          { name: `over ${bestLine}`, odds: bestOver },
          { name: `under ${bestLine}`, odds: bestUnder },
        ],
        margin,
      ),
    });
  }
  void totalsCandidates; // nearest-to-2.5 chosen above

  return out;
}

/**
 * The full pre-match feed: fixtures (1 req) → batch odds (1 req), merged by
 * fixtureId. Exported separately so the harness can test without a DB.
 */
export async function fetchOddspapiFeed(opts: {
  key: string;
  margin: number;
  bookmaker?: string;
  categories?: string;
  maxLeagues?: number;
  daysAhead?: number;
}): Promise<ApiGame[]> {
  const client = new OddspapiClient(opts.key);
  const bookmaker = opts.bookmaker ?? process.env.ODDS_PAPI_BOOKMAKER ?? "pinnacle";
  const categories = (opts.categories ?? process.env.ODDS_PAPI_CATEGORIES ?? DEFAULT_CATEGORIES)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const maxLeagues = opts.maxLeagues ?? (Number(process.env.ODDS_PAPI_LEAGUES ?? 20) || 20);
  const daysAhead = opts.daysAhead ?? 7;

  const markets = await getMarkets(client);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + daysAhead * 86400_000);

  const fixtures = await client.get<OddspapiFixture[]>("/fixtures", {
    sportId: Number(SOCCER),
    from: from.toISOString(),
    to: to.toISOString(),
    statusId: 0, // pre-match only
    hasOdds: true,
    bookmakers: bookmaker,
  });

  const wanted = fixtures.filter((f) =>
    categories.some(
      (c) => f.categoryName.toLowerCase().includes(c) || f.tournamentName.toLowerCase().includes(c),
    ),
  );
  const tournIds = [...new Set(wanted.map((f) => f.tournamentId))].slice(0, maxLeagues);
  const kept = wanted.filter((f) => tournIds.includes(f.tournamentId));
  if (!kept.length) return [];

  let oddsByTourn: OddspapiOddsFixture[] = [];
  // The API caps tournamentIds at 5 per request — chunk the league set.
  for (let i = 0; i < tournIds.length; i += 5) {
    const chunk = tournIds.slice(i, i + 5);
    try {
      const part = await client.get<OddspapiOddsFixture[]>("/odds-by-tournaments", {
        bookmaker,
        tournamentIds: chunk.join(","),
      });
      oddsByTourn.push(...part);
    } catch {
      /* odds optional for this chunk — fixtures still import without markets */
    }
  }
  const oddsByFixture = new Map(oddsByTourn.map((o) => [o.fixtureId, o]));

  return kept.map((f) => ({
    externalId: f.fixtureId,
    sportKey: SOCCER,
    competitionName: `${f.categoryName} - ${f.tournamentName}`,
    homeName: f.participant1Name,
    awayName: f.participant2Name,
    startAt: new Date(f.startTime),
    markets: extractMarkets(oddsByFixture.get(f.fixtureId) ?? { fixtureId: f.fixtureId, participant1Id: 0, participant2Id: 0, tournamentId: 0, statusId: 0, startTime: f.startTime, bookmakerOdds: {} }, bookmaker, markets, f.participant1Name, f.participant2Name, opts.margin),
  }));
}

export class OddspapiProvider implements OddsProvider {
  id = "oddspapi";

  async fetchSports() {
    return [{ key: SOCCER, name: "Soccer" }];
  }

  async fetchUpcomingGames(sportKeys: string[]) {
    if (!sportKeys.includes(SOCCER)) return [];
    const margin = (await getSettings()).oddsMarginPercent;
    const key = process.env.ODDSPAPI_KEY ?? "";
    if (!key) throw new Error("ODDSPAPI_KEY is not set");
    return fetchOddspapiFeed({ key, margin });
  }

  /** Live fixtures + scores. 1 request for the live list + 1 per scored
   *  fixture (capped by ODDS_PAPI_LIVE_SCORES) — per-fixture scores are
   *  expensive on a monthly quota, so the cap keeps it sane. */
  async fetchLiveScores(sportKeys: string[]): Promise<ApiScore[]> {
    if (!sportKeys.includes(SOCCER)) return [];
    const key = process.env.ODDSPAPI_KEY ?? "";
    if (!key) return [];
    const client = new OddspapiClient(key);
    const bookmaker = process.env.ODDS_PAPI_BOOKMAKER ?? "pinnacle";
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 6 * 3600_000);
      const fixtures = await client.get<OddspapiFixture[]>("/fixtures", {
        sportId: Number(SOCCER),
        from: from.toISOString(),
        to: now.toISOString(),
        statusId: 1, // live
        bookmakers: bookmaker,
      });
      const cap = Number(process.env.ODDS_PAPI_LIVE_SCORES ?? 10) || 10;
      const out: ApiScore[] = [];
      for (const f of fixtures.slice(0, cap)) {
        try {
          const sc = await client.get<{ scores: Record<string, { participant1Score: number; participant2Score: number }> }>("/scores", {
            fixtureId: f.fixtureId,
          });
          const periods = Object.values(sc.scores ?? {});
          const last = periods[periods.length - 1];
          out.push({
            externalId: f.fixtureId,
            status: "live",
            homeScore: last?.participant1Score,
            awayScore: last?.participant2Score,
          });
        } catch {
          /* skip individual score failures */
        }
      }
      return out;
    } catch {
      return [];
    }
  }
}
