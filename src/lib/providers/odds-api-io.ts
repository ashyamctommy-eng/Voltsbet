/**
 * Odds-API.io provider — api.odds-api.io/v3 (the company at odds-api.io).
 *
 * Real-time odds from 265+ bookmakers across 34 sports (incl. African +
 * global football), REST API. Requires env: ODDS_IO_KEY  (free plan: 2
 * recreational bookmakers, 100 req/hour; select them in the dashboard or via
 * PUT /bookmakers/selected/select).
 *
 * Endpoints used (verified live 2026-08):
 *   GET /events?sport=football            → events (defaults next 14 days,
 *                                           hard cap 5000, status pending/live/
 *                                           settled/cancelled, scores included)
 *   GET /leagues?sport=football           → league registry (name/slug) used to
 *                                           enrich events + optional curation
 *                                           via ODDS_IO_LEAGUE_SLUGS
 *   GET /odds/multi?eventIds=1,2,…&bookmakers=…  → odds for ≤10 events/call,
 *                                           merged per market type across books
 *   GET /events/live?sport=football       → in-play events + clock (minute,
 *                                           period, running, statusDetail)
 *   GET /bookmakers/selected              → user's selected bookmakers
 * Auth: ?apiKey=… query param (key from https://odds-api.io/dashboard).
 */
import { ApiGame, OddsProvider } from "./odds-api";
import { applyMarginGrid } from "../margin";
import { getSettings } from "../settings";

const BASE = "https://api.odds-api.io/v3";
/** /odds/multi accepts up to 10 event ids per call. */
const ODDS_BATCH = 10;
/** Cap on imported pending events per sync (soonest kickoffs win). */
const MAX_EVENTS = Number(process.env.ODDS_IO_MAX_EVENTS ?? 150) || 150;
/** Bookmaker override; defaults to the account's selected bookmakers. */
const BOOKMAKERS_OVERRIDE = (process.env.ODDS_IO_BOOKMAKERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** Optional curation: comma-separated league slugs — only these are imported.
 *  Set via env ODDS_IO_LEAGUE_SLUGS or Admin → Odds & Risk → odds.io.leagueSlugs.
 *  A slug matches exactly OR as a prefix ("international-clubs-uefa-champions-
 *  league" also covers "-playoff-round" / "-league-phase" variants). */
const ENV_LEAGUE_SLUGS = (process.env.ODDS_IO_LEAGUE_SLUGS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function leagueMatches(slug: string | undefined, curated: string[]): boolean {
  if (!slug || !curated.length) return curated.length === 0;
  return curated.some((s) => slug === s || slug.startsWith(`${s}-`));
}

/** Status vocabulary accepted for upcoming fixtures ("pending" per the API,
 *  "NOT_STARTED" / "NS" per the spec/other providers). */
const UPCOMING_STATUSES = new Set(["pending", "scheduled", "NOT_STARTED", "NS"]);
/** Status vocabulary accepted as in-play. */
const LIVE_STATUSES = new Set(["live", "IN_PLAY", "1H", "2H", "HT"]);

type OddsValue = Record<string, string | number>;
type Market = { name: string; updatedAt?: string; odds: OddsValue[] };

type Event = {
  id: number;
  home: string;
  away: string;
  date: string; // ISO
  status: string; // pending | live | settled | cancelled
  league?: { name?: string; slug?: string };
  scores?: { home: number | null; away: number | null };
  clock?: { minute?: number | null; period?: number | null; running?: boolean | null };
};

type OddsEvent = Event & { bookmakers?: Record<string, Market[]> };

export class OddsIoProvider implements OddsProvider {
  id = "odds-api-io";

  private key: string;

  constructor() {
    this.key = process.env.ODDS_IO_KEY ?? "";
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.key) throw new Error("ODDS_IO_KEY is not set");
    const res = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${this.key}`);
    if (!res.ok) throw new Error(`Odds-API.io ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json() as Promise<T>;
  }

  async fetchSports() {
    // /sports needs no auth; other sports map through SPORT_KEY_MAP anyway.
    const res = await fetch(`${BASE}/sports`);
    if (!res.ok) throw new Error(`Odds-API.io ${res.status}`);
    const data = (await res.json()) as { name: string; slug: string }[];
    return data.map((s) => ({ key: s.slug, name: s.name }));
  }

  async fetchUpcomingGames(sportKeys: string[]) {
    if (!sportKeys.includes("football")) return [];
    const settings = await getSettings();
    const margin = settings.oddsMarginPercent;
    // Env wins over the DB setting; empty = import everything (long tail).
    const curated =
      ENV_LEAGUE_SLUGS.length > 0
        ? ENV_LEAGUE_SLUGS
        : (settings.oddsIoLeagueSlugs ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const events = await this.get<Event[]>(`/events?sport=football`);

    // League registry (GET /v3/leagues) — authoritative league names/slugs.
    // Used to enrich events that carry a slug but no name, and to optionally
    // curate the import set via the curated slug list above.
    let leagueNameBySlug = new Map<string, string>();
    try {
      const leagues = await this.get<{ slug: string; name: string }[]>(`/leagues?sport=football`);
      leagueNameBySlug = new Map(leagues.map((l) => [l.slug, l.name]));
    } catch {
      /* enrichment optional — events already carry league names */
    }

    const upcoming = events
      .filter((e) => UPCOMING_STATUSES.has(e.status))
      .filter((e) => leagueMatches(e.league?.slug, curated))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, MAX_EVENTS);
    if (!upcoming.length) return [];

    const oddsByEvent = await this.fetchOddsBatch(
      upcoming.map((e) => e.id),
    );

    return upcoming.map((e) => ({
      externalId: `oddsio-${e.id}`,
      sportKey: "football",
      competitionName: e.league?.name ?? (e.league?.slug ? leagueNameBySlug.get(e.league.slug) : undefined),
      homeName: e.home,
      awayName: e.away,
      startAt: new Date(e.date),
      markets: this.buildMarkets(e, oddsByEvent.get(e.id) ?? [], margin),
    }));
  }

  /** Fetch odds for up to MAX_EVENTS events in batches of 10 via /odds/multi. */
  private async fetchOddsBatch(ids: number[]): Promise<Map<number, Market[]>> {
    const map = new Map<number, Market[]>();
    const bookmakers = BOOKMAKERS_OVERRIDE.length
      ? BOOKMAKERS_OVERRIDE
      : await this.selectedBookmakers();
    if (!bookmakers.length) return map;

    for (let i = 0; i < ids.length; i += ODDS_BATCH) {
      const chunk = ids.slice(i, i + ODDS_BATCH);
      try {
        const odds = await this.get<OddsEvent[]>(
          `/odds/multi?eventIds=${chunk.join(",")}&bookmakers=${bookmakers.join(",")}`,
        );
        for (const ev of odds) {
          // Merge per MARKET TYPE across the selected bookmakers — take each
          // market (ML, Double Chance, Totals, …) from the first bookmaker
          // that prices it, so a thin book never starves a whole event.
          const merged: Market[] = [];
          const seen = new Set<string>();
          for (const bk of bookmakers) {
            for (const m of ev.bookmakers?.[bk] ?? []) {
              if (!seen.has(m.name)) {
                seen.add(m.name);
                merged.push(m);
              }
            }
          }
          if (merged.length) map.set(ev.id, merged);
        }
      } catch {
        /* odds optional — game still imported without odds */
      }
    }
    return map;
  }

  private async selectedBookmakers(): Promise<string[]> {
    try {
      const sel = await this.get<{ bookmakers: string[] }>(`/bookmakers/selected`);
      if (sel.bookmakers?.length) return sel.bookmakers;
    } catch {
      /* fall back below */
    }
    return ["1xbet"];
  }

  private buildMarkets(e: Event, markets: Market[], margin: number): ApiGame["markets"] {
    const out: ApiGame["markets"] = [];
    for (const m of markets) {
      const odds = m.odds?.[0];
      if (!odds) continue;

      switch (m.name) {
        case "ML": {
          const home = Number(odds.home);
          const draw = Number(odds.draw);
          const away = Number(odds.away);
          if (!(home > 1 && draw > 1 && away > 1)) continue;
          const outcomes: { name: string; label?: string; odds: number }[] = [
            { name: e.home, label: "1", odds: home },
            { name: "Draw", label: "X", odds: draw },
            { name: e.away, label: "2", odds: away },
          ];
          out.push({
            key: "MATCH_RESULT",
            name: "Match Result",
            outcomes: applyMarginGrid(outcomes, margin),
          });
          break;
        }
        case "Double Chance": {
          const x = Number(odds["1X"]);
          const twelve = Number(odds["12"]);
          const y = Number(odds["X2"]);
          if (!(x > 1 && twelve > 1 && y > 1)) continue;
          out.push({
            key: "DOUBLE_CHANCE",
            name: "Double Chance",
            // lowercase names so auto-settle matches (1x / x2 / 12)
            outcomes: applyMarginGrid(
              [
                { name: "1x", odds: x },
                { name: "12", odds: twelve },
                { name: "x2", odds: y },
              ],
              margin,
            ),
          });
          break;
        }
        case "Totals": {
          const over = Number(odds.over);
          const under = Number(odds.under);
          if (!(over > 1 && under > 1)) continue;
          const line = odds.hdp ?? 0;
          out.push({
            key: "OVER_UNDER",
            name: `Over/Under ${line}`,
            // lowercase so auto-settle matches (over/under prefix + line)
            outcomes: applyMarginGrid(
              [
                { name: `over ${line}`, odds: over },
                { name: `under ${line}`, odds: under },
              ],
              margin,
            ),
          });
          break;
        }
        case "Both Teams To Score": {
          const yes = Number(odds.yes);
          const no = Number(odds.no);
          if (!(yes > 1 && no > 1)) continue;
          out.push({
            key: "BTTS",
            name: "Both Teams To Score",
            outcomes: applyMarginGrid(
              [
                { name: "yes", odds: yes },
                { name: "no", odds: no },
              ],
              margin,
            ),
          });
          break;
        }
        default:
          break; // Spread, Team Totals, Corners, Correct Score, European Handicap, …
      }
    }
    return out;
  }

  async fetchLiveScores(sportKeys: string[]) {
    if (!sportKeys.includes("football")) return [];
    // /events/live covers every sport — filter to football (and accept the
    // spec's IN_PLAY alias) so tennis etc. never match football games.
    const events = (await this.get<Event[]>(`/events/live?sport=football`)).filter((e) =>
      LIVE_STATUSES.has(e.status),
    );
    return events.map((e) => {
      const clock = e.clock?.minute != null ? `${e.clock.minute}'` : undefined;
      return {
        externalId: `oddsio-${e.id}`,
        status: "live" as const,
        homeScore: e.scores?.home ?? undefined,
        awayScore: e.scores?.away ?? undefined,
        period: e.clock?.period != null ? `Period ${e.clock.period}` : undefined,
        clock,
      };
    });
  }
}
