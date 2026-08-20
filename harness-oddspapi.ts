/**
 * Oddspapi live test harness — no DB needed (margin passed directly).
 *
 * Run:   ODDSPAPI_KEY=your_key npx tsx harness-oddspapi.ts
 *        (optionally ODDS_PAPI_BOOKMAKER=pinnacle ODDS_PAPI_CATEGORIES=... )
 *
 * Prints: account/quota, feed size, league breakdown, sample markets.
 */
import { fetchOddspapiFeed } from "./src/lib/providers/oddspapi";
import { OddspapiProvider } from "./src/lib/providers/oddspapi";

const key = process.env.ODDSPAPI_KEY ?? "";
if (!key) {
  console.error("Missing ODDSPAPI_KEY — set it and re-run.");
  process.exit(1);
}

async function main() {
  // 1. Account + quota (unmetered endpoint)
  const provider = new OddspapiProvider();
  const client = (provider as unknown as { client?: never });
  void client;
  const acct = await fetch(`https://api.oddspapi.io/v4/account?apiKey=${key}`)
    .then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
    .catch((e) => ({ error: e.message }));
  console.log("ACCOUNT:", JSON.stringify(acct));

  // 2. Pre-match feed (fixtures + batch odds)
  const margin = Number(process.env.ODDS_PAPI_MARGIN ?? 6);
  const games = await fetchOddspapiFeed({ key, margin });
  console.log(`\nFEED: ${games.length} pre-match fixtures (margin ${margin}%)`);

  const byLeague = new Map<string, number>();
  for (const g of games) {
    byLeague.set(g.competitionName ?? "?", (byLeague.get(g.competitionName ?? "?") ?? 0) + 1);
  }
  for (const [league, n] of [...byLeague.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${n.toString().padStart(3)}  ${league}`);
  }

  // 3. Market breakdown on the first 5 fixtures
  for (const g of games.slice(0, 5)) {
    const keys = g.markets.map((m) => `${m.key}(${m.outcomes.filter((o) => o.odds > 1).length})`).join(" ");
    const sample = g.markets[0]?.outcomes.map((o) => `${o.label ?? o.name}:${o.odds}`).join(" ") ?? "";
    console.log(`\n  ${g.homeName} vs ${g.awayName} @ ${g.startAt.toISOString()} — ${keys}`);
    if (sample) console.log(`    1X2: ${sample}`);
  }

  // 4. Live fixtures (statusId=1)
  const scores = await provider.fetchLiveScores(["10"]);
  console.log(`\nLIVE: ${scores.length} scored fixtures`);
  for (const s of scores.slice(0, 5)) {
    console.log(`  ${s.externalId} ${s.homeScore ?? "-"}-${s.awayScore ?? "-"}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
