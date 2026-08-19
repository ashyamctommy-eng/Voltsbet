/**
 * BetsAPI via RapidAPI — bet365 odds feed (betsapi2.p.rapidapi.com).
 *
 * PRIMARY provider for sports events, live scores and odds. Credentials are
 * DB-backed (Admin → API Settings): X-RapidAPI-Key / X-RapidAPI-Host / Base
 * Target URL.
 *
 * Endpoints verified live 2026-08 (RapidAPI BetsAPI package, BASIC plan):
 *   GET /v1/bet365/upcoming?sport_id=1   → fixture LIST (metadata only: id/FI,
 *       time unix, time_status "0", league, home, away — NO odds here)
 *   GET /v3/bet365/prematch?FI=<id>      → per-event bet365 markets (1 req per
 *       event). Markets live in main.sp / others[]: full_time_result (1X2),
 *       double_chance, goals_over_under, both_teams_to_score, draw_no_bet …
 *       Each market: { id, name, odds: [{ id, odds: "1.80", name|header,
 *       handicap }] }.
 *   GET /v1/bet365/inplay?sport_id=1     → live feed (RapidAPI returns the RAW
 *       compressed bet365 format — parsed v3 variant may also exist; we
 *       tolerate both, degrading gracefully)
 *   GET /v1/bet365/result?event_id=<id>  → finished outcome (time_status "3",
 *       ss "5-0", scores map) for settlement
 *
 * Budget: upcoming list = 1–3 req, prematch = 1 req per priced event
 * (BETSAPI_ODDS_EVENTS, default 20), live = 1, results = 1 per due game
 * (capped 20). BASIC plan is rate-limited per hour — keep runs modest.
 */
import { ApiGame, ApiScore, OddsProvider } from "./odds-api";
import { applyMarginGrid } from "../margin";
import { getSettings } from "../settings";

const DEFAULT_HOST = "betsapi2.p.rapidapi.com";
const DEFAULT_BASE = "https://betsapi2.p.rapidapi.com";
const FOOTBALL_SPORT_ID = "1";

/** Upcoming fixture list page size (per the API pager). */
const LIST_PAGE_SIZE = 50;
/** Max upcoming fixtures imported per sync. */
const MAX_EVENTS = Number(process.env.BETSAPI_MAX_EVENTS ?? 150) || 150;
/** Max events that get per-event prematch odds (1 request each). */
const ODDS_EVENTS = Number(process.env.BETSAPI_ODDS_EVENTS ?? 20) || 20;
/** Max finished-result sweeps per sync (1 request each). */
const RESULT_SWEEP = Number(process.env.BETSAPI_RESULT_SWEEP ?? 20) || 20;

type OddsLeg = { id?: string; odds?: string; name?: string | null; header?: string | null; handicap?: string | null };
type BetsApiMarket = { id?: string; name?: string; odds?: OddsLeg[] };

/** Upcoming-list event (metadata source). */
type BetsApiEvent = {
  id: string; // = FI for prematch
  time: number | string; // unix seconds
  time_status: string; // "0" pre-match, "1" in-play, "3" finished
  league?: { id?: string; name?: string };
  home?: { id?: string; name?: string };
  away?: { id?: string; name?: string };
  ss?: string | null; // final score "5-0"
  timer?: string | null;
  scores?: { "1"?: { home?: string; away?: string }; "2"?: { home?: string; away?: string } };
};

/** Prematch odds payload (markets for a single FI). */
type PrematchResult = {
  FI?: string;
  event_id?: string;
  main?: { sp?: Record<string, BetsApiMarket> };
  others?: { sp?: Record<string, BetsApiMarket> }[];
};

/** Map time_status → local status ("1" = IN_PLAY / live, "0" = NOT_STARTED). */
function localStatus(timeStatus: string | undefined): ApiScore["status"] {
  if (timeStatus === "1") return "live";
  if (timeStatus === "3") return "finished";
  return "scheduled";
}

/** Look up one market by key across main.sp (and others as a fallback). */
function findMarket(prematch: PrematchResult | null, key: string): BetsApiMarket | null {
  if (!prematch) return null;
  const fromMain = prematch.main?.sp?.[key];
  if (fromMain?.odds?.length) return fromMain;
  for (const other of prematch.others ?? []) {
    const m = other.sp?.[key];
    if (m?.odds?.length) return m;
  }
  return null;
}

/**
 * Apply the margin grid to priced legs only; missing legs stay odds 0 so the
 * card renders them as "-" (never feed 0-odds to the margin engine).
 */
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
    o.odds > 1 ? repriced[i++] : { name: o.name, label: o.label, odds: 0 },
  );
}

const legOdds = (m: BetsApiMarket | null, match: (l: OddsLeg) => boolean) =>
  m?.odds?.find(match)?.odds;

/**
 * Parse a BetsAPI event (+ its prematch markets) into our ApiGame shape.
 * Missing market values become odds 0 — the card renders them as "-".
 */
export function parseBetsApiMatch(item: BetsApiEvent, prematch: PrematchResult | null, margin: number): ApiGame {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v != null && isFinite(n) && n > 1 ? n : 0;
  };
  const homeName = item.home?.name ?? "Home";
  const awayName = item.away?.name ?? "Away";
  const markets: ApiGame["markets"] = [];

  // 1X2 — full_time_result odds: name "1" | "Draw" | "2"
  const ftr = findMarket(prematch, "full_time_result");
  const home = num(legOdds(ftr, (l) => l.name === "1" || l.header === "1"));
  const draw = num(legOdds(ftr, (l) => l.name?.toLowerCase() === "draw"));
  const away = num(legOdds(ftr, (l) => l.name === "2" || l.header === "2"));
  if (home > 0 || draw > 0 || away > 0) {
    markets.push({
      key: "MATCH_RESULT",
      name: "Match Result",
      outcomes: priceOutcomes(
        [
          { name: homeName, label: "1", odds: home },
          { name: "Draw", label: "X", odds: draw },
          { name: awayName, label: "2", odds: away },
        ],
        margin,
      ),
    });
  }

  // Double Chance — names like "Fulham or Draw" (1X), "Draw or Arsenal" (X2),
  // "Fulham or Arsenal" (12) → normalize to settle-friendly 1x/12/x2.
  const dc = findMarket(prematch, "double_chance");
  const dcLegs = (dc?.odds ?? []).slice(0, 3);
  const dcPick: Record<string, number> = {};
  for (const l of dcLegs) {
    const n = (l.name ?? "").toLowerCase();
    let key: string | null = null;
    if (n.endsWith("or draw")) key = "1x";
    else if (n.startsWith("draw or")) key = "x2";
    else if (n.includes(" or ")) key = "12";
    if (key) dcPick[key] = num(l.odds);
  }
  // positional fallback (1X, X2, 12) if names were plain
  if (!Object.keys(dcPick).length && dcLegs.length >= 2) {
    dcPick["1x"] = num(dcLegs[0]?.odds);
    dcPick["x2"] = num(dcLegs[1]?.odds);
    if (dcLegs[2]) dcPick["12"] = num(dcLegs[2]?.odds);
  }
  if (Object.values(dcPick).some((v) => v > 0)) {
    markets.push({
      key: "DOUBLE_CHANCE",
      name: "Double Chance",
      outcomes: priceOutcomes(
        [
          { name: "1x", odds: dcPick["1x"] ?? 0 },
          { name: "12", odds: dcPick["12"] ?? 0 },
          { name: "x2", odds: dcPick["x2"] ?? 0 },
        ],
        margin,
      ),
    });
  }

  // Totals — goals_over_under: { name: line "2.5", header: Over|Under, odds }
  const gou = findMarket(prematch, "goals_over_under");
  let bestLine = -1;
  let bestOver = 0;
  let bestUnder = 0;
  const byLine = new Map<number, { over: number; under: number }>();
  for (const l of gou?.odds ?? []) {
    const line = Number(l.name ?? l.handicap);
    if (!isFinite(line) || line <= 0) continue;
    const bucket = byLine.get(line) ?? { over: 0, under: 0 };
    if ((l.header ?? l.name ?? "").toLowerCase().startsWith("over")) bucket.over = num(l.odds);
    if ((l.header ?? l.name ?? "").toLowerCase().startsWith("under")) bucket.under = num(l.odds);
    byLine.set(line, bucket);
  }
  for (const [line, b] of byLine) {
    if (b.over <= 0 || b.under <= 0) continue;
    if (bestLine < 0 || Math.abs(line - 2.5) < Math.abs(bestLine - 2.5)) {
      bestLine = line;
      bestOver = b.over;
      bestUnder = b.under;
    }
  }
  if (bestLine > 0) {
    markets.push({
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

  // Both Teams To Score — Yes/No
  const btts = findMarket(prematch, "both_teams_to_score");
  const btsYes = num(legOdds(btts, (l) => l.name?.toLowerCase() === "yes" || l.header?.toLowerCase() === "yes"));
  const btsNo = num(legOdds(btts, (l) => l.name?.toLowerCase() === "no" || l.header?.toLowerCase() === "no"));
  if (btsYes > 0 || btsNo > 0) {
    markets.push({
      key: "BTTS",
      name: "Both Teams To Score",
      outcomes: priceOutcomes(
        [
          { name: "yes", odds: btsYes },
          { name: "no", odds: btsNo },
        ],
        margin,
      ),
    });
  }

  // Draw No Bet — odds: name "1" | "2"
  const dnb = findMarket(prematch, "draw_no_bet");
  const dnbHome = num(legOdds(dnb, (l) => l.name === "1" || l.header === "1"));
  const dnbAway = num(legOdds(dnb, (l) => l.name === "2" || l.header === "2"));
  if (dnbHome > 0 || dnbAway > 0) {
    markets.push({
      key: "DRAW_NO_BET",
      name: "Draw No Bet",
      outcomes: priceOutcomes(
        [
          { name: homeName, label: "1", odds: dnbHome },
          { name: awayName, label: "2", odds: dnbAway },
        ],
        margin,
      ),
    });
  }

  return {
    externalId: `betsapi-${item.id}`,
    sportKey: FOOTBALL_SPORT_ID,
    competitionName: item.league?.name,
    homeName,
    awayName,
    startAt: new Date(Number(item.time) * 1000),
    markets,
  };
}

export class BetsApiProvider implements OddsProvider {
  id = "betsapi";

  private async creds() {
    const s = await getSettings();
    return {
      key: s.apiRapidKey,
      host: s.apiRapidHost || DEFAULT_HOST,
      base: s.apiRapidBase || DEFAULT_BASE,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const { key, host, base } = await this.creds();
    if (!key) throw new Error("RapidAPI key not configured — set it in Admin → API Settings");
    const res = await fetch(`${base}${path}`, {
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": host },
    });
    if (!res.ok) throw new Error(`BetsAPI ${res.status}: ${await res.text().catch(() => "")}`);
    const json = (await res.json()) as { success?: number; error?: string; error_detail?: string; message?: string; results?: T };
    if (json.success !== 1) {
      throw new Error(`BetsAPI error: ${json.error_detail ?? json.error ?? json.message ?? JSON.stringify(json)}`);
    }
    return (json.results ?? []) as T;
  }

  async fetchSports() {
    // Sport id 1 = soccer — verified live; keep the map static (zero requests).
    return [{ key: FOOTBALL_SPORT_ID, name: "Soccer" }];
  }

  /** Prematch odds for one event (deep bet365 markets). */
  async fetchPrematch(fi: string): Promise<PrematchResult | null> {
    try {
      const results = await this.get<PrematchResult[]>(`/v3/bet365/prematch?FI=${encodeURIComponent(fi)}`);
      return results[0] ?? null;
    } catch {
      return null; // rate-limited or no odds — game still imports without markets
    }
  }

  async fetchUpcomingGames(sportKeys: string[]) {
    if (!sportKeys.includes(FOOTBALL_SPORT_ID)) return [];
    const margin = (await getSettings()).oddsMarginPercent;

    // 1) Fixture list (metadata only) — page-walk, stop on a short page.
    const fixtures: BetsApiEvent[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await this.get<BetsApiEvent[]>(`/v1/bet365/upcoming?sport_id=${FOOTBALL_SPORT_ID}&page=${page}`);
      if (!batch.length) break;
      fixtures.push(...batch.filter((e) => e.time_status === "0"));
      if (batch.length < LIST_PAGE_SIZE) break;
    }
    const upcoming = fixtures
      .sort((a, b) => Number(a.time) - Number(b.time))
      .slice(0, MAX_EVENTS);
    if (!upcoming.length) return [];

    // 2) Odds for the soonest ODDS_EVENTS fixtures (1 prematch request each).
    const oddsTarget = upcoming.slice(0, ODDS_EVENTS);
    const prematchByFi = new Map<string, PrematchResult | null>();
    for (const ev of oddsTarget) {
      prematchByFi.set(ev.id, await this.fetchPrematch(ev.id));
    }

    return upcoming.map((e) => parseBetsApiMatch(e, prematchByFi.get(e.id) ?? null, margin));
  }

  async fetchLiveScores(sportKeys: string[]) {
    if (!sportKeys.includes(FOOTBALL_SPORT_ID)) return [];
    try {
      const data = await this.get<BetsApiEvent[] | unknown[][]>(`/v3/bet365/inplay?sport_id=${FOOTBALL_SPORT_ID}`);
      // RapidAPI may serve the RAW compressed bet365 format (array-of-arrays)
      // which has no team names — in that case we degrade gracefully.
      if (!Array.isArray(data) || !data.length) return [];
      if (Array.isArray(data[0])) return []; // raw format detected
      return (data as BetsApiEvent[])
        .filter((e) => localStatus(e.time_status) === "live")
        .map((e) => ({
          externalId: `betsapi-${e.id}`,
          status: "live" as const,
          homeScore: e.scores?.["2"]?.home != null ? Number(e.scores["2"].home) : undefined,
          awayScore: e.scores?.["2"]?.away != null ? Number(e.scores["2"].away) : undefined,
          clock: e.timer || undefined,
        }));
    } catch {
      return []; // live feed unavailable — pre-match data still syncs
    }
  }

  /** Finished outcomes for settlement — one /result request per event id. */
  async fetchResults(ids: string[]): Promise<ApiScore[]> {
    const out: ApiScore[] = [];
    const fios = ids.map((id) => id.replace(/^betsapi-/, "")).slice(0, RESULT_SWEEP);
    for (const fi of fios) {
      try {
        const results = await this.get<BetsApiEvent[]>(`/v1/bet365/result?event_id=${encodeURIComponent(fi)}`);
        const r = results[0];
        if (!r || localStatus(r.time_status) !== "finished") continue;
        const [hs, as] = String(r.ss ?? "").split("-").map((n) => Number(n));
        out.push({
          externalId: `betsapi-${r.id ?? fi}`,
          status: "finished",
          homeScore: Number.isFinite(hs) ? hs : undefined,
          awayScore: Number.isFinite(as) ? as : undefined,
        });
      } catch {
        /* skip individual failures (rate limit etc.) */
      }
    }
    return out;
  }
}
