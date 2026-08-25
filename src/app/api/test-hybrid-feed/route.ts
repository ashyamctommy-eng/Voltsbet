/**
 * TEST-ONLY — Hybrid feed for the match-card preview (/test-preview).
 *
 * Fixtures:  Sportmonks v3 (real) — date range, participants;league;state;venue.
 * Odds chain (real responses only, NO mock by default):
 *   1. Sportmonks odds — /v3/football/odds/pre-match/fixtures/{id}. Gated:
 *      returns 403 code 5007 unless the Odds Feed add-on is on the plan
 *      (verified on the Starter trial). Bookmaker selection via the
 *      SPORTMONKS_BOOKMAKER_IDS env (e.g. "2" = bet365) → filters=bookmakers:.
 *      Market catalog (25 markets incl. Asian Handicap, Correct Score) lives
 *      at /v3/odds/markets; bookmakers at /v3/odds/bookmakers — both free.
 *   2. The Odds API — ODDS_API_KEY (h2h + totals, aggregated across books).
 *   3. null — fixture renders without odds ("-" state). Design-testing with
 *      sample prices: append ?mock=1.
 */
import { NextRequest, NextResponse } from "next/server";

const TOKEN = process.env.SPORTMONKS_API_TOKEN ?? "";
const ODDS_API_KEY = process.env.ODDS_API_KEY ?? "";
const SPORTMONKS_BOOKMAKERS = process.env.SPORTMONKS_BOOKMAKER_IDS ?? "";
const BASE = "https://api.sportmonks.com/v3";

export type HybridOutcome = { name: string; odds: number | null };
export type HybridMarket = { key: string; name: string; outcomes: HybridOutcome[] };

export type HybridMatch = {
  id: string;
  sport: string;
  league: string;
  country: string | null;
  venue: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoff: string; // ISO 8601
  status: "NS" | "LIVE" | "FT" | "POSTP" | "CANC";
  statusLabel: string;
  /** null = no prices at all (no odds source matched / suspended). */
  markets: HybridMarket[] | null;
  oddsSource: "sportmonks" | "the-odds-api" | "mock" | null;
  marketCount: number;
};

const STATUS_LABELS: Record<string, string> = {
  NS: "Not Started", LIVE: "Live", "1H": "Live — 1st Half", "2H": "Live — 2nd Half",
  HT: "Half-Time", ET: "Live — Extra Time", PEN_LIVE: "Live — Pens",
  FT: "Finished", FT_PEN: "Finished (Pens)", AWD: "Awarded", WO: "Walkover",
  POSTP: "Postponed", CANC: "Cancelled", ABD: "Abandoned", SUS: "Suspended",
  DELAY: "Delayed", INT: "Interrupted",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── Mock (opt-in via ?mock=1, design testing only) ─────────────────── */
function rng(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => { h = (h * 1103515245 + 12345) >>> 0; return (h % 1000) / 1000; };
}
function mockH2H(seed: string) {
  const r = rng(seed);
  const home = 1.7 + r() * 2.6, draw = 2.8 + r() * 1.7, away = 1.7 + r() * 3.1;
  const k = 1.04 / (1 / home + 1 / draw + 1 / away);
  return { home: round2(home * k), draw: round2(draw * k), away: round2(away * k) };
}
function mockTotals(seed: string) {
  const r = rng(seed + ":totals");
  const over = 1.7 + r() * 0.55;
  return { over: round2(over), under: round2(1 / (1.04 - 1 / over)) };
}
function buildMockMarkets(id: string): HybridMarket[] {
  const h = mockH2H(id), t = mockTotals(id);
  const p = { home: 1 / h.home, draw: 1 / h.draw, away: 1 / h.away };
  const dc = (a: number, c: number) => round2(Math.max(1.01, 1 / (a + c)));
  const dnb = (a: number, c: number) => round2(Math.max(1.01, 1 / (a / (a + c))));
  return [
    { key: "h2h", name: "1X2 — Match Result", outcomes: [
      { name: "1", odds: h.home }, { name: "X", odds: h.draw }, { name: "2", odds: h.away }]},
    { key: "totals", name: "Over/Under 2.5", outcomes: [
      { name: "Over 2.5", odds: t.over }, { name: "Under 2.5", odds: t.under }]},
    { key: "double_chance", name: "Double Chance", outcomes: [
      { name: "1X", odds: dc(p.home, p.draw) }, { name: "12", odds: dc(p.home, p.away) }, { name: "X2", odds: dc(p.draw, p.away) }]},
    { key: "draw_no_bet", name: "Draw No Bet", outcomes: [
      { name: "1", odds: dnb(p.home, p.away) }, { name: "2", odds: dnb(p.away, p.home) }]},
    { key: "btts", name: "Both Teams To Score", outcomes: [
      { name: "Yes", odds: 2.1 }, { name: "No", odds: 1.7 }]},
  ];
}

/* ── Chain step 1: Sportmonks odds (gated on current plan) ──────────── */
const SM_DESC_TO_KEY: Record<string, string> = {
  "fulltime result": "h2h", "match winner": "h2h",
  "over/under": "totals", "match goals": "totals", "goal line": "totals",
  "double chance": "double_chance", "draw no bet": "draw_no_bet",
  "both teams to score": "btts", "asian handicap": "asian_handicap",
  "final score": "correct_score",
};
const SM_MARKET_NAMES: Record<string, string> = {
  h2h: "1X2 — Match Result", totals: "Over/Under 2.5", double_chance: "Double Chance",
  draw_no_bet: "Draw No Bet", btts: "Both Teams To Score",
  asian_handicap: "Asian Handicap", correct_score: "Correct Score",
};

async function fetchSportmonksOdds(fixtureId: string): Promise<HybridMarket[] | null> {
  try {
    let url = `${BASE}/football/odds/pre-match/fixtures/${fixtureId}?include=market;bookmaker`;
    if (SPORTMONKS_BOOKMAKERS) url += `&filters=bookmakers:${SPORTMONKS_BOOKMAKERS}`;
    const res = await fetch(url, { headers: { Authorization: TOKEN }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null; // 403 code 5007 (odds add-on not on plan)
    const json = await res.json();
    const data: any[] = json?.data ?? [];
    if (!Array.isArray(data) || data.length === 0) return null;
    const byDesc = new Map<string, { name: string; odds: number }[]>();
    for (const o of data) {
      const desc = String(o.market_description ?? "").toLowerCase();
      const key = SM_DESC_TO_KEY[desc];
      if (!key) continue;
      const val = Number(o.value);
      if (!(val > 1)) continue;
      if (!byDesc.has(key)) byDesc.set(key, []);
      byDesc.get(key)!.push({ name: String(o.label ?? o.name ?? desc), odds: round2(val) });
    }
    const markets: HybridMarket[] = [...byDesc.entries()]
      .filter(([, o]) => o.length >= 2)
      .map(([key, outcomes]) => ({ key, name: SM_MARKET_NAMES[key] ?? key, outcomes }));
    return markets.length ? markets : null;
  } catch {
    return null;
  }
}

/* ── Chain step 2: The Odds API (h2h + totals, aggregated across books) ─ */
const oddsApiCache = new Map<string, { at: number; games: any[] }>();
const ODDS_TTL_MS = 10 * 60 * 1000;
const LEAGUE_TO_ODDS_API_KEY: Record<string, string> = {
  "premier league": "soccer_epl", "la liga": "soccer_spain_la_liga",
  "serie a": "soccer_italy_serie_a", "serie b": "soccer_italy_serie_b",
  "bundesliga": "soccer_germany_bundesliga", "bundesliga 2": "soccer_germany_bundesliga2",
  "ligue 1": "soccer_france_ligue_one", "ligue 2": "soccer_france_ligue_two",
  "champions league": "soccer_uefa_champs_league",
  "pro league": "soccer_saudi_arabia_pro_league", // fixtures only on US free tier (0 books)
  "europa league": "soccer_uefa_europa_league",
  "eredivisie": "soccer_netherlands_eredivisie", "primeira liga": "soccer_portugal_primeira_liga",
  "efl championship": "soccer_efl_champ", "spl": "soccer_spl",
  "brazil serie a": "soccer_brazil_campeonato", "super lig": "soccer_turkey_super_league",
};

async function fetchTheOddsApiLeague(sportKey: string): Promise<any[] | null> {
  if (!ODDS_API_KEY) return null;
  const hit = oddsApiCache.get(sportKey);
  if (hit && Date.now() - hit.at < ODDS_TTL_MS) return hit.games;
  try {
    const regions = process.env.ODDS_API_REGIONS ?? "us";
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?regions=${regions}&markets=h2h,totals&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const games: any[] = await res.json();
    if (!Array.isArray(games)) return null;
    oddsApiCache.set(sportKey, { at: Date.now(), games });
    return games;
  } catch { return null; }
}

function marketsFromTheOddsApiGame(g: any): HybridMarket[] | null {
  const books: any[] = g?.bookmakers ?? [];
  const markets: HybridMarket[] = [];
  for (const key of ["h2h", "totals"]) {
    const book = books.find((b) => (b?.markets ?? []).some((m: any) => m.key === key));
    const m = book?.markets?.find((m: any) => m.key === key);
    if (!m || !m.outcomes?.length) continue;
    markets.push({
      key, name: key === "h2h" ? "1X2 — Match Result" : "Over/Under 2.5",
      outcomes: m.outcomes.map((o: any) => ({ name: o.name, odds: round2(Number(o.price)) })),
    });
  }
  return markets.length ? markets : null;
}

async function fetchTheOddsApiOdds(league: string, home: string, away: string): Promise<HybridMarket[] | null> {
  const sportKey = LEAGUE_TO_ODDS_API_KEY[String(league).toLowerCase()];
  if (!sportKey) return null;
  const games = await fetchTheOddsApiLeague(sportKey);
  if (!games?.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const game = games.find((g) => norm(g.home_team) === norm(home) && norm(g.away_team) === norm(away))
    ?? games.find((g) => norm(g.home_team) === norm(home) || norm(g.away_team) === norm(away));
  return game ? marketsFromTheOddsApiGame(game) : null;
}

/* ── Reference lists (free endpoints — bookmaker + market catalogs) ──── */
let refsCache: { at: number; bookmakers: number; markets: number; bookmakerNames: string[] } | null = null;
async function fetchReferenceLists() {
  const now = Date.now();
  if (refsCache && now - refsCache.at < 3600_000) return refsCache;
  const out = { bookmakers: 0, markets: 0, bookmakerNames: [] as string[] };
  try {
    const [b, m] = await Promise.all([
      fetch(`${BASE}/odds/bookmakers`, { headers: { Authorization: TOKEN }, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/odds/markets`, { headers: { Authorization: TOKEN }, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null),
    ]);
    out.bookmakers = b?.data?.length ?? 0;
    out.markets = m?.data?.length ?? 0;
    out.bookmakerNames = (b?.data ?? []).map((x: any) => x.name);
  } catch { /* leave zeros */ }
  refsCache = { at: now, ...out };
  return refsCache;
}

function mapStatus(status: string): HybridMatch["status"] {
  if (["LIVE", "1H", "2H", "HT", "ET", "PEN_LIVE"].includes(status)) return "LIVE";
  if (["FT", "FT_PEN", "AWD", "WO"].includes(status)) return "FT";
  if (status === "POSTP") return "POSTP";
  if (status === "CANC") return "CANC";
  return "NS";
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

async function fetchSportmonksFixtures(): Promise<Omit<HybridMatch, "markets" | "oddsSource" | "marketCount">[] | null> {
  if (!TOKEN) return null;
  try {
    const res = await fetch(
      `${BASE}/football/fixtures/date/${todayISO()}?include=participants;league;state;venue&per_page=30`,
      { headers: { Authorization: TOKEN }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data: any[] = json?.data ?? [];
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.slice(0, 12).map((f) => {
      const parts: { name?: string; meta?: { location?: string } }[] = Array.isArray(f.participants) ? f.participants : [];
      // Sportmonks: home/away signalled by participant meta.location, NOT array
      // order (localteam_id/visitorteam_id are null when participants included).
      const byLoc = (loc: string) => parts.find((p) => p.meta?.location === loc)?.name;
      const home = byLoc("home") ?? parts[0]?.name ?? "Home";
      const away = byLoc("away") ?? parts[1]?.name ?? "Away";
      const status: string = f.status ?? "NS";
      return {
        id: `smk-${f.id}`, sport: "Soccer",
        league: f.league?.name ?? "Football", country: f.league?.country?.name ?? null,
        venue: f.venue?.name ?? null,
        homeTeam: home, awayTeam: away,
        kickoff: f.starting_at ?? new Date().toISOString(),
        status: mapStatus(status), statusLabel: STATUS_LABELS[status] ?? status,
      };
    });
  } catch { return null; }
}

let cache: { at: number; mock: boolean; body: unknown } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const mock = req.nextUrl.searchParams.get("mock") === "1";
  const now = Date.now();
  if (cache && cache.mock === mock && now - cache.at < CACHE_TTL_MS) return NextResponse.json(cache.body);

  const fixtures = await fetchSportmonksFixtures();
  const list = fixtures ?? [];
  const refs = await fetchReferenceLists();

  const matches = await Promise.all(list.map(async (f) => {
    const fixtureId = f.id.replace(/^smk-/, "");
    let markets: HybridMarket[] | null = null;
    let oddsSource: HybridMatch["oddsSource"] = null;
    if (/^\d+$/.test(fixtureId)) {
      markets = await fetchSportmonksOdds(fixtureId);
      if (markets) oddsSource = "sportmonks";
    }
    if (!markets) {
      markets = await fetchTheOddsApiOdds(f.league, f.homeTeam, f.awayTeam);
      if (markets) oddsSource = "the-odds-api";
    }
    if (!markets && mock) {
      markets = buildMockMarkets(f.id);
      oddsSource = "mock";
    }
    return { ...f, markets, oddsSource, marketCount: markets?.length ?? 0 };
  }));

  const body = {
    source: fixtures ? "sportmonks-live" : "sportmonks-empty",
    mockMode: mock,
    note: mock
      ? "TEST-ONLY hybrid feed — real fixtures + MOCK odds (?mock=1)."
      : "TEST-ONLY hybrid feed — real fixtures + real odds chain (sportmonks → the-odds-api). No mock.",
    date: todayISO(),
    count: matches.length,
    catalog: {
      bookmakersAvailable: refs.bookmakers,
      marketsAvailable: refs.markets,
      configuredBookmakers: SPORTMONKS_BOOKMAKERS
        ? `${SPORTMONKS_BOOKMAKERS} (${refs.bookmakerNames.filter((_, i) => i < 0).length ? "" : "see bookmakerNames"})`
        : "all (no filter)",
      bookmakerNames: refs.bookmakerNames.slice(0, 10),
    },
    matches,
  };
  cache = { at: now, mock, body };
  return NextResponse.json(body);
}
