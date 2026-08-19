/**
 * BetsAPI via RapidAPI — bet365 odds feed (betsapi2.p.rapidapi.com).
 *
 * PRIMARY provider for sports events, live scores and odds (bet365 markets:
 * 1X2, Double Chance, Totals, BTTS). Credentials are DB-backed (Admin →
 * API Settings): X-RapidAPI-Key / X-RapidAPI-Host / Base Target URL.
 *
 * Endpoints used (betsapi v3):
 *   GET /v3/sports                       → sport ids (1 = soccer, …)
 *   GET /v3/bet365/prematch?sport_id=1   → upcoming events + bet365 odds
 *   GET /v3/bet365/inplay?sport_id=1     → live events with timer + scores
 *
 * bet365 odds live in item.sp: { home, draw, away, 1x, 12, x2,
 * over_1.5/under_1.5, both_score_yes/no, … } — values are decimal strings.
 */
import { ApiGame, ApiScore, OddsProvider } from "./odds-api";
import { applyMarginGrid } from "../margin";
import { getSettings } from "../settings";

const DEFAULT_HOST = "betsapi2.p.rapidapi.com";
const DEFAULT_BASE = "https://betsapi2.p.rapidapi.com";

/** BetsAPI sport ids we map to local sports (1 = soccer). */
const SPORT_IDS = ["1", "2", "3", "4"];

type Sp = Record<string, string | undefined>;
type BetsApiEvent = {
  id: string;
  time: number; // unix seconds
  time_status: string; // "0" = pre-match, "1" = in-play
  timer?: string | null; // e.g. "67'"
  league?: { id?: number; name?: string };
  home?: { id?: number; name?: string };
  away?: { id?: number; name?: string };
  scores?: { home?: string; away?: string };
  sp?: Sp;
};

/** Map time_status → local status ("1" = IN_PLAY / live, "0" = NOT_STARTED). */
function localStatus(timeStatus: string | undefined): ApiScore["status"] {
  return timeStatus === "1" ? "live" : "scheduled";
}

/**
 * Apply the margin grid to the priced legs only, keep missing legs at odds 0
 * (the card renders them as "-"). Avoids feeding 0-odds legs to the margin
 * engine (which would produce Infinity/NaN books).
 */
function priceOutcomes(
  outcomes: { name: string; label?: string; odds: number }[],
  margin: number,
): { name: string; label?: string; odds: number }[] {
  const present = outcomes.filter((o) => o.odds > 1);
  if (present.length < 2) {
    // Lone leg — nothing to book against; pass through as-is.
    return outcomes.map((o) => ({ name: o.name, label: o.label, odds: o.odds > 1 ? Math.round(o.odds * 20) / 20 : 0 }));
  }
  const repriced = applyMarginGrid(present, margin);
  let i = 0;
  return outcomes.map((o) =>
    o.odds > 1 ? repriced[i++] : { name: o.name, label: o.label, odds: 0 },
  );
}

/**
 * Parse a BetsAPI bet365 event into our ApiGame shape.
 * Missing market values become odds 0 — the card renders them as "-".
 */
export function parseBetsApiMatch(item: BetsApiEvent, margin: number): ApiGame {
  const sp = item.sp ?? {};
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v != null && isFinite(n) && n > 1 ? n : 0;
  };

  const markets: ApiGame["markets"] = [];

  // 1X2 (home / draw / away)
  const home = num(sp.home);
  const draw = num(sp.draw);
  const away = num(sp.away);
  if (home > 0 || draw > 0 || away > 0) {
    const outcomes: { name: string; label?: string; odds: number }[] = [
      { name: item.home?.name ?? "Home", label: "1", odds: home },
      { name: "Draw", label: "X", odds: draw },
      { name: item.away?.name ?? "Away", label: "2", odds: away },
    ];
    markets.push({
      key: "MATCH_RESULT",
      name: "Match Result",
      outcomes: priceOutcomes(outcomes, margin),
    });
  }

  // Double Chance (1x / 12 / x2)
  const dc1x = num(sp["1x"] ?? sp["1X"]);
  const dc12 = num(sp["12"]);
  const dcx2 = num(sp["x2"] ?? sp["X2"]);
  if (dc1x > 0 || dc12 > 0 || dcx2 > 0) {
    markets.push({
      key: "DOUBLE_CHANCE",
      name: "Double Chance",
      outcomes: priceOutcomes(
        [
          { name: "1x", odds: dc1x },
          { name: "12", odds: dc12 },
          { name: "x2", odds: dcx2 },
        ],
        margin,
      ),
    });
  }

  // Totals — pick the over/under pair whose line is nearest 2.5 (main line)
  let bestLine = -1;
  let bestOver = 0;
  let bestUnder = 0;
  for (const key of Object.keys(sp)) {
    const m = key.match(/^over_([\d.]+)$/);
    if (!m) continue;
    const line = Number(m[1]);
    const over = num(sp[key]);
    const under = num(sp[`under_${m[1]}`]);
    if (over <= 0 || under <= 0) continue;
    if (bestLine < 0 || Math.abs(line - 2.5) < Math.abs(bestLine - 2.5)) {
      bestLine = line;
      bestOver = over;
      bestUnder = under;
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

  // Both Teams To Score (bonus — auto-settle supports it)
  const btsYes = num(sp["both_score_yes"]);
  const btsNo = num(sp["both_score_no"]);
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

  return {
    externalId: `betsapi-${item.id}`,
    sportKey: "1", // soccer — SPORT_KEY_MAP translates to local "football"
    competitionName: item.league?.name,
    homeName: item.home?.name ?? "Home",
    awayName: item.away?.name ?? "Away",
    startAt: new Date((item.time ?? 0) * 1000),
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
    const json = (await res.json()) as { success?: number; error?: unknown; results?: T };
    if (json.success !== 1) {
      throw new Error(`BetsAPI error: ${JSON.stringify(json.error ?? json)}`);
    }
    return (json.results ?? []) as T;
  }

  async fetchSports() {
    const sports = await this.get<{ id: number; name: string }[]>(`/v3/sports`);
    return sports.filter((s) => SPORT_IDS.includes(String(s.id))).map((s) => ({ key: String(s.id), name: s.name }));
  }

  async fetchUpcomingGames(sportKeys: string[]) {
    if (!sportKeys.includes("1")) return [];
    const margin = (await getSettings()).oddsMarginPercent;
    const events: BetsApiEvent[] = [];

    // Prematch odds — walk a few pages; stop when a page comes back short.
    for (let page = 1; page <= 5; page++) {
      const batch = await this.get<BetsApiEvent[]>(`/v3/bet365/prematch?sport_id=1&page=${page}`);
      if (!batch.length) break;
      events.push(...batch.filter((e) => e.time_status === "0"));
      if (batch.length < 20) break;
    }

    const MAX = 150;
    return events
      .slice(0, MAX)
      .map((e) => parseBetsApiMatch(e, margin));
  }

  async fetchLiveScores(sportKeys: string[]) {
    if (!sportKeys.includes("1")) return [];
    const events = await this.get<BetsApiEvent[]>(`/v3/bet365/inplay?sport_id=1`);
    return events
      .filter((e) => localStatus(e.time_status) === "live")
      .map((e) => ({
        externalId: `betsapi-${e.id}`,
        status: "live" as const,
        homeScore: e.scores?.home != null ? Number(e.scores.home) : undefined,
        awayScore: e.scores?.away != null ? Number(e.scores.away) : undefined,
        clock: e.timer || undefined,
      }));
  }
}
