#!/usr/bin/env tsx
/**
 * DRY-RUN market-density audit — Bovada coverage on The Odds API.
 *
 * ZERO database mutations: this script only fires read-only Odds API GETs
 * and prints a report. It does not touch the sync pipeline or any DB row.
 *
 *   npx tsx scripts/test-bovada-markets.ts
 *
 * Env: THE_ODDS_API_KEY (falls back to ODDS_API_KEY; a local .env is loaded
 *      automatically when present). Override sport via AUDIT_SPORT.
 *
 * Note on market keys: the audit requests the REAL Odds API keys
 * (double_chance, h2h_h1, totals_h1 — the h2h_1st_half-style names 422 and
 * are dropped gracefully if ever configured). Any key the API rejects is
 * reported and retried without it, mirroring the app's sync behaviour.
 */
import { deriveMarketsFrom1x2, DERIVED_MARKET_KEYS, type DerivedMarket } from "@/lib/derived-markets";

// ── env ──────────────────────────────────────────────────────────────────
if (!process.env.THE_ODDS_API_KEY && !process.env.ODDS_API_KEY) {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    /* no .env — rely on the shell env */
  }
}
const API_KEY = process.env.THE_ODDS_API_KEY ?? process.env.ODDS_API_KEY ?? "";
if (!API_KEY) {
  console.error("❌ No API key — set THE_ODDS_API_KEY (or ODDS_API_KEY) or add a .env file.");
  process.exit(1);
}

const BOOKMAKER = "bovada";
const SPORT = process.env.AUDIT_SPORT ?? "soccer_epl";
const TOP_N = 3;
const BASE = "https://api.the-odds-api.com/v4";
/** The real extended market set (h1/h2 half-line keys verified live). */
const MARKETS = [
  "h2h",
  "spreads",
  "totals",
  "double_chance",
  "draw_no_bet",
  "btts",
  "alternate_spreads",
  "alternate_totals",
  "h2h_h1",
  "totals_h1",
];

// ── tiny HTTP helper (read-only) ─────────────────────────────────────────
async function getJson<T>(path: string): Promise<T> {
  const joiner = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${joiner}apiKey=${API_KEY}`);
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`) as Error & {
      status?: number;
      body?: string;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return JSON.parse(body) as T;
}

type ApiSport = { key: string; title: string; active: boolean };
type ApiEvent = { id: string; home_team: string; away_team: string; commence_time: string };
type ApiMarket = { key: string; outcomes: { name: string; price: number }[] };
type ApiOddsEvent = {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: { key: string; markets: ApiMarket[] }[];
};

// ── helpers ──────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => s.padEnd(n);

function fetchWithGracefulDrop(eventId: string, markets: string[]): Promise<ApiOddsEvent[] | ApiOddsEvent> {
  return (async () => {
    try {
      return await getJson<ApiOddsEvent[]>(
        `/sports/${SPORT}/events/${eventId}/odds?bookmakers=${BOOKMAKER}&markets=${markets.join(",")}&oddsFormat=decimal`,
      );
    } catch (e) {
      const m = e instanceof Error ? e.message.match(/Invalid markets: ([^\]]+)/i) : null;
      if (m) {
        const invalid = new Set(m[1].split(",").map((s) => s.trim()));
        const keep = markets.filter((k) => !invalid.has(k));
        console.log(`   ↪ API rejected keys [${[...invalid].join(", ")}] — retrying without them`);
        if (!keep.length) throw e;
        return getJson<ApiOddsEvent[]>(
          `/sports/${SPORT}/events/${eventId}/odds?bookmakers=${BOOKMAKER}&markets=${keep.join(",")}&oddsFormat=decimal`,
        );
      }
      throw e;
    }
  })();
}

// ── run ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  Bovada market-density audit (dry-run · read-only · no DB)  │");
  console.log("└─────────────────────────────────────────────────────────────┘");
  console.log(`Bookmaker: ${BOOKMAKER} · Sport: ${SPORT} · Top ${TOP_N} fixtures\n`);

  // 1) sport + upcoming fixtures
  const sports = await getJson<ApiSport[]>("/sports/");
  const sport = sports.find((s) => s.key === SPORT);
  console.log(`Sport: ${SPORT} — ${sport?.title ?? "unknown"} (active: ${sport?.active ?? "?"})\n`);

  const events = await getJson<ApiEvent[]>(`/sports/${SPORT}/events/`);
  const fixtures = events.slice(0, TOP_N);
  if (!fixtures.length) {
    console.error(`No upcoming fixtures for ${SPORT}.`);
    process.exit(1);
  }

  let grandOutcomes = 0;
  let grandDerivedOutcomes = 0;
  const lines: string[] = [];

  for (const [i, ev] of fixtures.entries()) {
    console.log(`━━━ Fixture ${i + 1}/${fixtures.length} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`${ev.home_team} vs ${ev.away_team}`);
    console.log(`ID: ${ev.id} · kickoff: ${ev.commence_time.replace("T", " ").slice(0, 16)}Z`);

    const odds = await fetchWithGracefulDrop(ev.id, MARKETS);
    // NOTE: /events/{id}/odds returns ONE event object (not an array) —
    // normalize both shapes.
    const event = Array.isArray(odds) ? odds[0] : odds;
    const bovada = event?.bookmakers?.find((b) => b.key === BOOKMAKER);

    if (!event || !bovada || !bovada.markets.length) {
      console.log(`   ⚠ Bovada serves NO markets for this fixture (bookmaker coverage gap).\n`);
      lines.push(`- ${ev.home_team} vs ${ev.away_team}: no markets`);
      continue;
    }

    const markets = bovada.markets;
    const keys = markets.map((m) => m.key);
    const outcomes = markets.reduce((n, m) => n + m.outcomes.length, 0);
    console.log(`   Market keys (${keys.length}): ${keys.join(", ")}`);
    for (const m of markets) {
      console.log(`     · ${pad(m.key, 18)} → ${m.outcomes.length} selections`);
    }
    console.log(`   Distinct market lines (outcomes): ${outcomes}`);

    // 2) simulate the derived engine on the fixture's 3-way h2h
    const h2h = markets.find((m) => m.key === "h2h" && m.outcomes.length === 3);
    if (h2h) {
      const derived = deriveMarketsFrom1x2(
        h2h.outcomes.map((o) => ({ name: o.name, odds: o.price })),
        ev.home_team,
        ev.away_team,
      );
      // Map raw API keys to the engine's local keys (same table the sync
      // uses) so overlap detection is exact: alternate_spreads ≡
      // ALTERNATE_SPREAD, h2h_h1 ≡ HT_RESULT, totals_h1 ≡ OVER_UNDER_1H…
      const KEY_MAP: Record<string, string> = {
        h2h: "H2H", spreads: "SPREAD", totals: "OVER_UNDER",
        alternate_spreads: "ALTERNATE_SPREAD", alternate_totals: "ALTERNATE_TOTALS",
        btts: "BTTS", double_chance: "DOUBLE_CHANCE", draw_no_bet: "DRAW_NO_BET",
        h2h_h1: "HT_RESULT", totals_h1: "OVER_UNDER_1H", spreads_h1: "SPREAD_1H",
        h2h_h2: "2H_RESULT", totals_h2: "OVER_UNDER_2H", spreads_h2: "SPREAD_2H",
        correct_score: "CORRECT_SCORE",
      };
      const servedLocal = new Set(keys.map((k) => KEY_MAP[k] ?? k.toUpperCase()));
      const extra: DerivedMarket[] = derived
        ? derived.markets.filter((d) => !servedLocal.has(d.key)) // engine only fills gaps
        : [];
      const extraOutcomes = extra.reduce((n, m) => n + m.outcomes.length, 0);
      console.log(`   [sim] Derived engine (3-way h2h found):`);
      console.log(`         +${extra.length} markets (${extra.map((m) => m.key).join(", ")} or already covered)`);
      console.log(`         +${extraOutcomes} extra outcome lines`);
      console.log(`   TOTAL with derived: ${markets.length + extra.length} markets · ${outcomes + extraOutcomes} outcome lines`);
      grandDerivedOutcomes += outcomes + extraOutcomes;
    } else {
      console.log(`   [sim] No 3-way h2h → derived engine not applicable (2-way market).`);
      grandDerivedOutcomes += outcomes;
    }
    grandOutcomes += outcomes;
    lines.push(`- ${ev.home_team} vs ${ev.away_team}: ${markets.length} markets / ${outcomes} outcomes`);
    console.log("");
  }

  // 3) summary
  console.log("━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(lines.join("\n"));
  console.log(`\nTotal outcomes across ${fixtures.length} fixtures (Bovada only): ${grandOutcomes}`);
  console.log(`Total outcomes with the derived engine filling gaps: ${grandDerivedOutcomes}`);
  console.log(`\nEngine keys tracked: ${DERIVED_MARKET_KEYS.join(", ")}`);
  console.log("(Audit complete — no database records were touched.)");
}

main().catch((e) => {
  console.error("Audit failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
