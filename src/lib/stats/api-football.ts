/**
 * API-Football (API-Sports) provider — the SETTLEMENT stats feed.
 *
 * Why it exists: The Odds API `/scores` only returns the final score, so
 * corners/cards and half-time markets cannot be settled automatically (they are
 * flagged `manual` in the market catalog) and HT/ET/PEN are kickoff estimates.
 * This provider supplies the missing facts, ON DEMAND for finished matches:
 *
 *   GET /fixtures?id=<id>                       → status (FT/AET/PEN/…), half-time
 *                                                 score, full-time/ET/penalty score
 *   GET /fixtures/statistics?fixture=<id>       → Corner Kicks, Yellow/Red Cards,
 *                                                 Possession, Shots … per team
 *   GET /fixtures?live=all                      → every live match in ONE call
 *                                                 (true elapsed minute + status)
 *
 * Verified live on the FREE plan (2026-09-10):
 *   ✅ live=all (19 matches, `elapsed` + `status.short`), fixtures by id, today's
 *      fixture list, finished-match statistics incl. Corner Kicks / Cards / HT score
 *   ❌ past dates ("Free plans do not have access to this date, try from
 *      <today> to <today+2>"), season-filtered queries, and `half=true` did NOT
 *      return per-half rows (totals only)
 *   Quota: 100 requests/day, 10 requests/minute
 *
 * Everything here is OFF by default (Setting `stats.provider` = "off") and every
 * call is budget-guarded — a refusal leaves the game in the admin review queue
 * rather than erroring.
 */
import { getSettings } from "@/lib/settings";
import { consumeStatsBudget, statsBudget } from "./budget";

export const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

/** Minimum gap between calls — the free plan allows 10 requests/minute. */
const STATS_RATE_LIMIT_MS = (() => {
  const n = Number(process.env.STATS_RATE_LIMIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : 6_500;
})();

let lastCallAt = 0;

// ── quota telemetry (mirrors the odds provider) ─────────────────────────────
export type StatsQuota = { remaining: number | null; limit: number | null; path: string; at: string };
let lastQuota: StatsQuota | null = null;
export function getStatsQuota(): StatsQuota | null {
  return lastQuota;
}

export class StatsUnavailableError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Key resolution: env wins (deployment), then the admin Setting. */
export async function resolveStatsKey(): Promise<string | null> {
  const env = process.env.API_FOOTBALL_KEY?.trim();
  if (env) return env;
  const s = await getSettings();
  return s.statsApiKey?.trim() || null;
}

/** Is the stats feed enabled AND configured? */
export async function statsEnabled(): Promise<boolean> {
  const s = await getSettings();
  if (s.statsProvider !== "api-football") return false;
  return !!(await resolveStatsKey());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet<T>(path: string): Promise<T> {
  const key = await resolveStatsKey();
  if (!key) throw new StatsUnavailableError("NO_KEY", "API-Football key not set (env API_FOOTBALL_KEY or Admin → API Settings).");

  const budget = await consumeStatsBudget(1);
  if (!budget.allowed) {
    throw new StatsUnavailableError("BUDGET", `Stats daily budget exhausted (${budget.used}/${budget.budget}).`);
  }

  const wait = STATS_RATE_LIMIT_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  const res = await fetch(`${API_FOOTBALL_BASE}${path}`, {
    headers: { "x-apisports-key": key },
    signal: AbortSignal.timeout(15_000),
  });

  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  const limit = res.headers.get("x-ratelimit-requests-limit");
  if (remaining !== null || limit !== null) {
    lastQuota = {
      remaining: remaining !== null ? Number(remaining) : null,
      limit: limit !== null ? Number(limit) : null,
      path: path.split("?")[0],
      at: new Date().toISOString(),
    };
    console.log(`[stats] quota · ${path.split("?")[0]} · remaining=${remaining ?? "?"} limit=${limit ?? "?"}`);
  }

  if (!res.ok) throw new StatsUnavailableError("HTTP", `API-Football ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);

  const json = (await res.json()) as { errors?: unknown; response?: unknown };
  const errs = json.errors;
  const hasErrors = Array.isArray(errs) ? errs.length > 0 : !!errs && Object.keys(errs as object).length > 0;
  if (hasErrors) {
    throw new StatsUnavailableError("API", `API-Football error: ${JSON.stringify(errs).slice(0, 200)}`);
  }
  return json as T;
}

// ── pure parsers (unit-tested against real payloads) ────────────────────────

export type ScoreHalf = { home: number | null; away: number | null };

export type StatsFixture = {
  fixtureId: number;
  status: string; // FT | AET | PEN | 1H | HT | 2H | ET | BT | P | NS | …
  elapsed: number | null;
  homeName: string;
  awayName: string;
  halftime: ScoreHalf;
  fulltime: ScoreHalf;
  extratime: ScoreHalf;
  penalty: ScoreHalf;
};

type RawFixture = {
  fixture?: { id?: number; status?: { short?: string; elapsed?: number | null } };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  score?: { halftime?: ScoreHalf; fulltime?: ScoreHalf; extratime?: ScoreHalf; penalty?: ScoreHalf };
};

export function parseFixture(payload: unknown): StatsFixture | null {
  const rows = (payload as { response?: RawFixture[] })?.response;
  const f = Array.isArray(rows) ? rows[0] : undefined;
  if (!f?.fixture?.id) return null;
  const g = f.score ?? {};
  const half = (h?: ScoreHalf): ScoreHalf => ({ home: h?.home ?? null, away: h?.away ?? null });
  return {
    fixtureId: f.fixture.id,
    status: f.fixture.status?.short ?? "NS",
    elapsed: f.fixture.status?.elapsed ?? null,
    homeName: f.teams?.home?.name ?? "",
    awayName: f.teams?.away?.name ?? "",
    halftime: half(g.halftime),
    fulltime: half(g.fulltime),
    extratime: half(g.extratime),
    penalty: half(g.penalty),
  };
}

export type TeamStats = {
  team: string;
  corners: number | null;
  yellow: number | null;
  red: number | null;
  possession: number | null;
};

type RawTeamStats = { team?: { name?: string }; statistics?: { type?: string; value?: unknown }[] };

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v.replace("%", "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Flatten the statistics array of one team into the fields settlement needs. */
export function parseTeamStats(t: RawTeamStats): TeamStats {
  const by = new Map<string, unknown>();
  for (const s of t.statistics ?? []) if (s?.type) by.set(String(s.type).toLowerCase(), s.value);
  return {
    team: t.team?.name ?? "",
    corners: toNum(by.get("corner kicks")),
    yellow: toNum(by.get("yellow cards")),
    red: toNum(by.get("red cards")),
    possession: toNum(by.get("ball possession")),
  };
}

export function parseStatistics(payload: unknown): TeamStats[] {
  const rows = (payload as { response?: RawTeamStats[] })?.response;
  return Array.isArray(rows) ? rows.map(parseTeamStats) : [];
}

// ── public fetchers ─────────────────────────────────────────────────────────

export async function fetchFixtureStats(fixtureId: number | string): Promise<StatsFixture | null> {
  const json = await apiGet<unknown>(`/fixtures?id=${encodeURIComponent(String(fixtureId))}`);
  return parseFixture(json);
}

export async function fetchMatchStatistics(fixtureId: number | string): Promise<TeamStats[]> {
  const json = await apiGet<unknown>(`/fixtures/statistics?fixture=${encodeURIComponent(String(fixtureId))}`);
  return parseStatistics(json);
}

/** One call for every live match — true elapsed minute + status (optional feature). */
export async function fetchLiveFixtures(): Promise<StatsFixture[]> {
  const json = await apiGet<unknown>(`/fixtures?live=all`);
  const rows = (json as { response?: RawFixture[] })?.response ?? [];
  return rows.map((r) => parseFixture({ response: [r] })).filter((f): f is StatsFixture => !!f);
}

/** Account status — used by the admin "Test connection" action (1 request). */
export async function fetchStatsAccount(): Promise<{ plan: string | null; active: boolean; used: number | null; limitDay: number | null }> {
  const json = await apiGet<{ response?: { subscription?: { plan?: string; active?: boolean }; requests?: { current?: number; limit_day?: number } } }>(
    "/status",
  );
  const r = json.response ?? {};
  return {
    plan: r.subscription?.plan ?? null,
    active: !!r.subscription?.active,
    used: r.requests?.current ?? null,
    limitDay: r.requests?.limit_day ?? null,
  };
}

/** Budget snapshot for the admin card / logs. */
export async function statsStatus(): Promise<{ enabled: boolean; keySet: boolean; budget: Awaited<ReturnType<typeof statsBudget>>; quota: StatsQuota | null }> {
  const [key, budget] = await Promise.all([resolveStatsKey(), statsBudget()]);
  const s = await getSettings();
  return { enabled: s.statsProvider === "api-football" && !!key, keySet: !!key, budget, quota: lastQuota };
}
