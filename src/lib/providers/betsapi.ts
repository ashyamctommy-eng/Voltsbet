/**
 * BetsApiProvider — BetsAPI (bet365 via RapidAPI) as an OddsProvider.
 *
 * Transport lives in `./betsapi-client` (BetsApiClient); data mapping lives in
 * `./betsapi-transformer` (extractOddsMarkets). This file owns only the
 * provider glue: fixture/metadata types, status mapping, and the sync-facing
 * fetch methods.
 *
 * Endpoint mapping (all via BetsApiClient, verified live 2026-08):
 *   getUpcomingEvents(sportId, page) → fixture LIST (metadata only: id/FI,
 *       time unix, time_status "0", league, home, away — NO odds here)
 *   getPrematchOdds(fi)              → per-event bet365 markets (1 req per
 *       event). Markets live in main.sp / others[]: full_time_result (1X2),
 *       double_chance, goals_over_under, both_teams_to_score, draw_no_bet.
 *   getInplay()                      → live feed (RapidAPI may return the RAW
 *       compressed format — we detect it and degrade gracefully)
 *   getResults(event_id)             → finished outcome for settlement
 *
 * Budget: upcoming list = 1–3 req, prematch = 1 req per priced event
 * (BETSAPI_ODDS_EVENTS, default 20), live = 1, results = 1 per due game
 * (capped 20). BASIC plan is rate-limited per hour — keep runs modest.
 */
import { ApiGame, ApiScore, OddsProvider } from "./odds-api";
import { getSettings } from "../settings";
import { BetsApiClient } from "./betsapi-client";
import { extractOddsMarkets } from "./betsapi-transformer";

const FOOTBALL_SPORT_ID = "1";

/** Upcoming fixture list page size (per the API pager). */
const LIST_PAGE_SIZE = 50;
/** Max upcoming fixtures imported per sync. */
const MAX_EVENTS = Number(process.env.BETSAPI_MAX_EVENTS ?? 150) || 150;
/** Max events that get per-event prematch odds (1 request each). */
const ODDS_EVENTS = Number(process.env.BETSAPI_ODDS_EVENTS ?? 20) || 20;
/** Max finished-result lookups per sync (1 request each). */
const RESULT_SWEEP = Number(process.env.BETSAPI_RESULT_SWEEP ?? 20) || 20;

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
  main?: { sp?: Record<string, { id?: string; name?: string; odds?: { id?: string; odds?: string; name?: string | null; header?: string | null; handicap?: string | null }[] }> };
  others?: { sp?: Record<string, { id?: string; name?: string; odds?: { id?: string; odds?: string; name?: string | null; header?: string | null; handicap?: string | null }[] }> }[];
};

/** Map time_status → local status ("1" = IN_PLAY / live, "0" = NOT_STARTED). */
function localStatus(timeStatus: string | undefined): ApiScore["status"] {
  if (timeStatus === "1") return "live";
  if (timeStatus === "3") return "finished";
  return "scheduled";
}

/** Parse a BetsAPI event (+ prematch markets) into our ApiGame shape. */
export function parseBetsApiMatch(item: BetsApiEvent, prematch: PrematchResult | null, margin: number): ApiGame {
  const homeName = item.home?.name ?? "Home";
  const awayName = item.away?.name ?? "Away";
  return {
    externalId: `betsapi-${item.id}`,
    sportKey: FOOTBALL_SPORT_ID,
    competitionName: item.league?.name,
    homeName,
    awayName,
    startAt: new Date(Number(item.time) * 1000),
    markets: extractOddsMarkets(prematch, homeName, awayName, margin),
  };
}

export class BetsApiProvider implements OddsProvider {
  id = "betsapi";

  async fetchSports() {
    // Sport id 1 = soccer — verified live; keep the map static (zero requests).
    return [{ key: FOOTBALL_SPORT_ID, name: "Soccer" }];
  }

  /** Prematch odds for one event (deep bet365 markets) via the shared client. */
  async fetchPrematch(fi: string): Promise<PrematchResult | null> {
    try {
      const client = await BetsApiClient.fromSettings();
      const res = await client.getPrematchOdds(fi);
      const results = (res.results ?? []) as PrematchResult[];
      return results[0] ?? null;
    } catch {
      return null; // rate-limited or no odds — game still imports without markets
    }
  }

  async fetchUpcomingGames(sportKeys: string[]) {
    if (!sportKeys.includes(FOOTBALL_SPORT_ID)) return [];
    const margin = (await getSettings()).oddsMarginPercent;
    const client = await BetsApiClient.fromSettings();

    // Step 1 — fixture list (metadata only): page-walk, stop on a short page.
    const fixtures: BetsApiEvent[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await client.getUpcomingEvents(FOOTBALL_SPORT_ID, page);
      const batch = (res.results ?? []) as BetsApiEvent[];
      if (!batch.length) break;
      fixtures.push(...batch.filter((e) => e.time_status === "0"));
      if (batch.length < LIST_PAGE_SIZE) break;
    }
    const upcoming = fixtures
      .sort((a, b) => Number(a.time) - Number(b.time))
      .slice(0, MAX_EVENTS);
    if (!upcoming.length) return [];

    // Step 2 — odds for the soonest ODDS_EVENTS fixtures, executed SEQUENTIALLY
    // (1 prematch request each) so rate limits degrade gracefully per event.
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
      const client = await BetsApiClient.fromSettings();
      const res = await client.getInplay();
      const data = (res.results ?? []) as BetsApiEvent[] | unknown[][];
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
    const client = await BetsApiClient.fromSettings();
    const fios = ids.map((id) => id.replace(/^betsapi-/, "")).slice(0, RESULT_SWEEP);
    for (const fi of fios) {
      try {
        const res = await client.getResults(fi);
        const results = (res.results ?? []) as BetsApiEvent[];
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
