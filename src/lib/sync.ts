/**
 * Sync service — pulls from The Odds API (v4) and upserts into the DB.
 * Dedup via Game.externalId (unique). Idempotent: repeated runs never
 * duplicate games, and odds are updated in place.
 *
 * The Odds API is the ONLY sports data provider. The /scores pipeline
 * (src/lib/live-scores.ts) owns in-play/finished games; this module owns
 * pre-match fixtures + odds — games that already kicked off are filtered
 * out here (commence_time > now) and never clobbered (see below).
 *
 * Wire-up options:
 *   1. Cron: run this module on a schedule (node-cron / system cron / Railway cron).
 *   2. On-demand: POST /api/admin/sync (admin button).
 *   3. Interval loop inside the Next.js server (simplest for a single instance).
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { TheOddsApi, OddsProvider, ApiGame, ODDS_MARKETS, LIST_MARKETS } from "@/lib/providers/odds-api";
import { teamLogo } from "@/lib/team-logos";
import { setSetting } from "@/lib/settings";
import { deriveDoubleChance, deriveDrawNoBet } from "@/lib/derived-markets";
import { LEAGUE_TITLES } from "@/lib/feed";

export const PROVIDERS: Record<string, () => OddsProvider> = {
  "the-odds-api": () => new TheOddsApi(), // the ONLY provider
};

/** Env var that gates the provider — checked before syncing so a missing key
 *  never silently skips. */
export const PROVIDER_KEY_ENV: Record<string, string> = {
  "the-odds-api": "ODDS_API_KEY",
};

// Map provider sport keys → local sport slugs. Extend per your feed.
// Keys verified against the live API (2026-08): The Odds API renamed several
// keys (soccer_la_liga → soccer_spain_la_liga, etc.). Tennis is now
// tournament-specific (tennis_atp_cincinnati_open, …) and cricket_ipl only
// exists during its season — add them back when in season, as needed.
export const SPORT_KEY_MAP: Record<string, string> = {
  // UEFA — priority 1 (club comps + nations league; qualification runs early season)
  soccer_uefa_champs_league: "football",
  soccer_uefa_champs_league_qualification: "football",
  soccer_uefa_europa_league: "football",
  soccer_uefa_nations_league: "football",
  // EFL — priority 2 (English Football League tiers + cup)
  soccer_efl_champ: "football",
  soccer_england_league1: "football",
  soccer_england_league2: "football",
  soccer_england_efl_cup: "football",
  // La Liga — priority 3
  soccer_spain_la_liga: "football",
  // Rest of the big five
  soccer_epl: "football", soccer_italy_serie_a: "football",
  soccer_germany_bundesliga: "football", soccer_france_ligue_one: "football",
  // Verified priced additions — live US free-tier probe 2026-08-25 (6-8 books)
  soccer_italy_serie_b: "football",
  soccer_germany_bundesliga2: "football",
  soccer_france_ligue_two: "football",
  soccer_spain_segunda_division: "football",
  soccer_netherlands_eredivisie: "football",
  soccer_portugal_primeira_liga: "football",
  soccer_spl: "football",
  soccer_brazil_campeonato: "football",
  soccer_usa_mls: "football",
  soccer_turkey_super_league: "football",
  // Paid-plan additions — verified in-season on the 20K plan (2026-08-31)
  soccer_argentina_primera_division: "football",
  soccer_austria_bundesliga: "football",
  soccer_belgium_first_div: "football",
  soccer_brazil_serie_b: "football",
  soccer_chile_campeonato: "football",
  soccer_china_superleague: "football",
  soccer_concacaf_leagues_cup: "football",
  soccer_conmebol_copa_libertadores: "football",
  soccer_conmebol_copa_sudamericana: "football",
  soccer_denmark_superliga: "football",
  soccer_finland_veikkausliiga: "football",
  soccer_greece_super_league: "football",
  soccer_japan_j_league: "football",
  soccer_league_of_ireland: "football",
  soccer_norway_eliteserien: "football",
  soccer_sweden_allsvenskan: "football",
  soccer_sweden_superettan: "football",
  basketball_nba: "basketball",
  basketball_euroleague: "basketball",
  baseball_mlb: "baseball", icehockey_nhl: "ice-hockey",
  rugbyleague_nrl: "rugby", handball_germany_bundesliga: "handball",
};

export async function syncGames(providerId?: string) {
  const providerId_ = providerId ?? "the-odds-api";
  const provider = PROVIDERS[providerId_]?.();
  if (!provider) throw new Error(`Unknown provider: ${providerId_}`);

  // Key guard — a missing key never silently skips.
  const keyEnv = PROVIDER_KEY_ENV[providerId_] ?? "ODDS_API_KEY";
  if (!process.env[keyEnv]) {
    return { skipped: true, reason: `${keyEnv} not set — keeping manual/seed games` };
  }

  const sports = await provider.fetchSports();
  const wanted = sports.filter((s) => SPORT_KEY_MAP[s.key]);
  const sportKeys = wanted.map((s) => s.key);

  const games = await provider.fetchUpcomingGames(sportKeys);

  // ── Batch prefetch (kills the N+1 loop) ────────────────────────────
  // Before: each of ~150 fixtures did findUnique(sport) + findUnique(game)
  // + per-market findFirst + per-outcome update → ~600 queries per run.
  // After: sports, games, markets and outcomes are pulled in 4 flat queries
  // up front; only actual row changes hit the DB inside the loop.
  const priced = games.filter((g) => g.markets?.length);
  const neededSlugs = [...new Set(priced.map((g) => SPORT_KEY_MAP[g.sportKey]).filter(Boolean))];
  const [sportRows, existingGames] = await Promise.all([
    prisma.sport.findMany({ where: { slug: { in: neededSlugs } } }),
    prisma.game.findMany({
      where: { externalId: { in: priced.map((g) => g.externalId) } },
      select: { id: true, externalId: true, status: true, homeLogo: true, awayLogo: true },
    }),
  ]);
  const sportsBySlug = new Map(sportRows.map((s) => [s.slug, s]));
  const gamesByExternalId = new Map(existingGames.map((g) => [g.externalId, g]));

  const liveLike = new Set(["LIVE", "HALF_TIME", "FINISHED", "CANCELLED", "POSTPONED"]);
  const plan: {
    game: ApiGame;
    sportId: string;
    existing?: { id: string; homeLogo: string | null; awayLogo: string | null };
  }[] = [];
  const inPlayBatch: ApiGame[] = [];
  for (const game of priced) {
    const sport = sportsBySlug.get(SPORT_KEY_MAP[game.sportKey]);
    if (!sport) continue;
    const existing = gamesByExternalId.get(game.externalId);
    // In-play events: the /odds endpoint carries live prices for them, so
    // refresh the markets of games the DB already knows — odds only. Never
    // create rows (the /scores pipeline owns in-play creation) and never
    // touch status/scores here. Finished/cancelled games are skipped (their
    // markets are settling).
    if (game.inPlay) {
      if (existing && !["FINISHED", "CANCELLED", "POSTPONED"].includes(existing.status)) {
        inPlayBatch.push(game);
      }
      continue;
    }
    // Never touch in-play / finished / cancelled games in the pre-match pass:
    // their markets may be suspended or settled, and re-marking them SCHEDULED
    // used to clobber live scores, resurrect settled outcomes and hide live
    // games from isLiveStatus() surfaces. The live-score pipeline owns them.
    if (existing && liveLike.has(existing.status)) continue;
    plan.push({ game, sportId: sport.id, existing });
  }

  // One query for every market (+outcomes) of every game we're touching.
  const marketRows = plan.length
    ? await prisma.market.findMany({
        where: { gameId: { in: plan.map((p) => p.existing?.id ?? "∅") } },
        include: { outcomes: true },
      })
    : [];
  const marketsByGame = new Map<string, typeof marketRows>();
  for (const m of marketRows) {
    const list = marketsByGame.get(m.gameId) ?? [];
    list.push(m);
    marketsByGame.set(m.gameId, list);
  }

  let created = 0, updated = 0;
  for (const { game, sportId, existing } of plan) {
    const payload = await buildPayload(game, sportId, existing ?? undefined);

    let gameId: string;
    if (existing) {
      await prisma.game.update({ where: { id: existing.id }, data: payload.game });
      gameId = existing.id;
      updated++;
    } else {
      const createdGame = await prisma.game.create({
        data: { ...payload.game, externalId: game.externalId, source: "API" },
      });
      gameId = createdGame.id;
      created++;
    }
    await upsertMarkets(gameId, game, marketsByGame.get(gameId) ?? []);
  }

  // Live-odds refresh for in-play events (same /odds payload, zero extra
  // requests): update market prices of games already known as live.
  let oddsUpdated = 0;
  if (inPlayBatch.length) {
    oddsUpdated = (await upsertInPlayOdds(inPlayBatch)).updated;
  }

  // Per-event extended markets (btts, correct_score, …) for the top leagues —
  // fetched from /events/{id}/odds for the nearest upcoming fixtures.
  const eventMarkets = await syncEventMarkets(priced.filter((g) => !g.inPlay));

  // Auto-hide seed/manual games once the provider feed is live — the site then
  // shows only synced (API) games. Auto-enables on any successful sync that
  // found feed games, but ONLY while the admin has never touched the toggle:
  // once it exists in settings (on or off), manual choice wins.
  if (created > 0 || updated > 0) {
    const existing = await prisma.setting.findUnique({ where: { key: "games.hideSeeded" } });
    if (!existing) {
      await setSetting("games.hideSeeded", "true");
    }
  }

  return {
    created,
    updated,
    oddsUpdated,
    eventMarkets,
    gamesSynced: games.length,
    provider: providerId_,
  };
}

/** Leagues that get per-event extended markets (btts, correct_score, …).
 *  Override via ODDS_API_EVENT_MARKET_LEAGUES (comma-separated sport keys).
 *  Empty string disables the per-event pass entirely. */
const EVENT_MARKET_LEAGUES = (
  process.env.ODDS_API_EVENT_MARKET_LEAGUES?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
    "soccer_epl",
    "soccer_uefa_champs_league",
    "soccer_italy_serie_a",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
  ]
);
/** Max events per league per sync for the per-event extended markets
 *  (quota: 1 credit per market per event — keep this small; 0 disables). */
const EVENT_MARKET_LIMIT = Math.max(0, Number(process.env.ODDS_API_EVENT_MARKET_LIMIT ?? 3)) || 0;

/**
 * Fetch + upsert the extended markets (everything in ODDS_MARKETS beyond the
 * list-supported h2h/spreads/totals) for the nearest upcoming fixtures of the
 * configured leagues. The /odds list endpoint cannot serve them — they live
 * on /events/{id}/odds for a limited set of bookmakers (see
 * ODDS_API_EVENT_BOOKMAKERS, default pinnacle). Events with no data are
 * skipped; DOUBLE_CHANCE / DRAW_NO_BET merge into the derived markets of the
 * same key (bookmaker prices overwrite derived ones), BTTS / CORRECT_SCORE
 * are created fresh. Settled markets are never touched (upsertMarkets).
 */
export async function syncEventMarkets(
  preMatchGames: ApiGame[],
): Promise<{ events: number; markets: number }> {
  const extended = ODDS_MARKETS.filter((m) => !(LIST_MARKETS as readonly string[]).includes(m));
  if (!extended.length || EVENT_MARKET_LEAGUES.length === 0) return { events: 0, markets: 0 };

  // Nearest LIMIT upcoming fixtures per configured league (cheapest first).
  const perLeague = new Map<string, ApiGame[]>();
  const sorted = [...preMatchGames].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (const g of sorted) {
    if (!EVENT_MARKET_LEAGUES.includes(g.sportKey)) continue;
    const list = perLeague.get(g.sportKey) ?? [];
    if (list.length >= EVENT_MARKET_LIMIT) continue;
    list.push(g);
    perLeague.set(g.sportKey, list);
  }
  const selected = [...perLeague.values()].flat();
  if (!selected.length) return { events: 0, markets: 0 };

  const provider = new TheOddsApi();
  const apiGames = await provider.fetchEventMarkets(
    selected.map((g) => ({ sportKey: g.sportKey, eventId: g.externalId, homeName: g.homeName, awayName: g.awayName })),
    extended,
  );
  if (!apiGames.length) return { events: 0, markets: 0 };

  const existing = await prisma.game.findMany({
    where: { externalId: { in: apiGames.map((g) => g.externalId) } },
    select: { id: true, externalId: true, status: true, homeLogo: true, awayLogo: true },
  });
  const byExternalId = new Map(existing.map((g) => [g.externalId, g.id]));
  const targets = apiGames.filter((g) => byExternalId.has(g.externalId));
  if (!targets.length) return { events: 0, markets: 0 };

  const marketRows = await prisma.market.findMany({
    where: { gameId: { in: targets.map((t) => byExternalId.get(t.externalId)!) } },
    include: { outcomes: true },
  });
  const marketsByGame = new Map<string, typeof marketRows>();
  for (const m of marketRows) {
    const list = marketsByGame.get(m.gameId) ?? [];
    list.push(m);
    marketsByGame.set(m.gameId, list);
  }

  let marketCount = 0;
  for (const g of targets) {
    const gameId = byExternalId.get(g.externalId)!;
    await upsertMarkets(gameId, g, marketsByGame.get(gameId) ?? []);
    marketCount += g.markets.length;
  }
  return { events: targets.length, markets: marketCount };
}

async function buildPayload(
  game: ApiGame,
  sportId: string,
  existing?: { homeLogo: string | null; awayLogo: string | null },
) {
  return {
    game: {
      sportId,
      // The Odds API odds payload has no per-game league name — stamp it from
      // the sport-key map so the homepage can rank by competition.
      competitionName: game.competitionName ?? LEAGUE_TITLES[game.sportKey] ?? null,
      homeName: game.homeName,
      awayName: game.awayName,
      // Logo from the curated dictionary when known; otherwise keep whatever
      // admin set manually, else null (UI falls back to initials).
      homeLogo: teamLogo(game.homeName) ?? existing?.homeLogo ?? null,
      awayLogo: teamLogo(game.awayName) ?? existing?.awayLogo ?? null,
      startAt: game.startAt,
      status: "SCHEDULED",
      // Pre-match sync rows are never live — explicitly reset the flag so
      // stale live:true from older syncs can't hide SCHEDULED games from
      // isLiveStatus() surfaces (home feed, slideshow). The live-score
      // pipeline re-marks genuinely in-play games.
      live: false,
      source: "API",
    },
  };
}

type MarketWithOutcomes = {
  id: string;
  gameId: string;
  key: string;
  status: string;
  outcomes: { id: string; name: string; settled: boolean; status: string; odds: unknown }[];
};

/**
 * Upsert a game's markets from the feed. `prefetched` carries the game's
 * existing markets+outcomes (one flat query for the whole sync run), so the
 * loop below does zero read queries. All outcome writes for the game are
 * batched into ONE transaction — worst case a sync touches 1 (game write)
 * + N (new-market creates) + 1 (batched outcome writes) round trips per
 * fixture instead of per-market/per-outcome queries.
 */
async function upsertMarkets(gameId: string, game: ApiGame, prefetched: MarketWithOutcomes[]) {
  const byKey = new Map<string, MarketWithOutcomes>();
  for (const m of prefetched) if (!byKey.has(m.key)) byKey.set(m.key, m);
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  for (const [i, m] of game.markets.entries()) {
    const existing = byKey.get(m.key);
    if (existing) {
      // Settled markets are sacred: never re-open, never re-price, never add
      // outcomes to them.
      if (existing.status === "SETTLED") continue;

      const feedNames = new Set(m.outcomes.map((o) => o.name));
      const existingByName = new Map(existing.outcomes.map((o) => [o.name, o]));

      for (const o of m.outcomes) {
        const outcome = existingByName.get(o.name);
        if (outcome) {
          // A settled outcome must never be resurrected by a feed refresh.
          if (outcome.settled) continue;
          const nextOdds = o.odds.toFixed(2);
          // Write only when something actually changed.
          if (Number(outcome.odds).toFixed(2) !== nextOdds || outcome.status !== "ACTIVE") {
            ops.push(
              prisma.outcome.update({
                where: { id: outcome.id },
                data: { odds: nextOdds, status: "ACTIVE" },
              })
            );
          }
        } else {
          ops.push(
            prisma.outcome.create({
              data: { marketId: existing.id, name: o.name, label: o.label ?? null, odds: o.odds.toFixed(2) },
            })
          );
        }
      }
      // Outcomes the feed no longer carries are stale prices — suspend them
      // (they stay bettable-proof without deleting history).
      for (const o of existing.outcomes) {
        if (!feedNames.has(o.name) && !o.settled && o.status !== "SUSPENDED") {
          ops.push(prisma.outcome.update({ where: { id: o.id }, data: { status: "SUSPENDED" } }));
        }
      }
    } else {
      const created = await prisma.market.create({
        data: {
          gameId,
          name: m.name,
          key: m.key,
          sortOrder: i,
          outcomes: { create: m.outcomes.map((o, j) => ({ name: o.name, label: o.label ?? null, odds: o.odds.toFixed(2), sortOrder: j })) },
        },
      });
      byKey.set(m.key, { id: created.id, gameId, key: m.key, status: "OPEN", outcomes: [] });
    }

    // Derive extra bettable markets from any full-time 3-way h2h (Double Chance, Draw No Bet)
    if (m.key === "MATCH_RESULT" || m.key === "h2h") {
      await upsertDerived(gameId, m, game.homeName, game.awayName, byKey, ops);
    }
  }

  if (ops.length) await prisma.$transaction(ops);
}

/** Upsert a derived market (DOUBLE_CHANCE / DRAW_NO_BET) from an h2h market.
 *  Outcome writes are pushed into the game's shared `ops` batch. */async function upsertDerived(
  gameId: string,
  source: { key: string; name: string; outcomes: { name: string; label?: string | null; odds: number }[] },
  homeName: string,
  awayName: string,
  byKey: Map<string, MarketWithOutcomes>,
  ops: Prisma.PrismaPromise<unknown>[],
) {
  const derived: { key: string; name: string; outcomes: { name: string; odds: string }[] | null }[] = [
    { key: "DOUBLE_CHANCE", name: "Double Chance", outcomes: deriveDoubleChance(source.outcomes, homeName, awayName) },
    { key: "DRAW_NO_BET", name: "Draw No Bet", outcomes: deriveDrawNoBet(source.outcomes, homeName, awayName) },
  ];
  for (const d of derived) {
    if (!d.outcomes) continue; // not a 3-way market (e.g. NBA moneyline)
    const existing = byKey.get(d.key);
    if (existing) {
      if (existing.status === "SETTLED") continue; // never touch settled markets
      const feedNames = new Set(d.outcomes.map((o) => o.name));
      const existingByName = new Map(existing.outcomes.map((o) => [o.name, o]));
      for (const o of d.outcomes) {
        const outcome = existingByName.get(o.name);
        if (outcome) {
          if (outcome.settled) continue; // never resurrect settled outcomes
          if (Number(outcome.odds).toFixed(2) !== o.odds || outcome.status !== "ACTIVE") {
            ops.push(prisma.outcome.update({ where: { id: outcome.id }, data: { odds: o.odds, status: "ACTIVE" } }));
          }
        } else {
          ops.push(prisma.outcome.create({ data: { marketId: existing.id, name: o.name, odds: o.odds } }));
        }
      }
      for (const o of existing.outcomes) {
        if (!feedNames.has(o.name) && !o.settled && o.status !== "SUSPENDED") {
          ops.push(prisma.outcome.update({ where: { id: o.id }, data: { status: "SUSPENDED" } }));
        }
      }
    } else {
      const created = await prisma.market.create({
        data: {
          gameId,
          name: d.name,
          key: d.key,
          sortOrder: 10,
          outcomes: { create: d.outcomes.map((o, j) => ({ name: o.name, odds: o.odds, sortOrder: j })) },
        },
      });
      // Keep the in-memory index honest so a second source market in the same
      // run sees the derived market instead of creating a duplicate.
      byKey.set(d.key, { id: created.id, gameId, key: d.key, status: "OPEN", outcomes: [] });
    }
  }
}

/**
 * Refresh market odds for in-play games from live /odds payloads.
 *
 * Used by the pre-match sync (which receives in-play events in the same
 * response, zero extra requests) and by the live-score pipeline (which
 * fetches /odds for active leagues on its own throttle). Strictly odds-only:
 * game rows are looked up by externalId and must already exist with a
 * live-ish status — nothing is created, and scores/status/flags are never
 * touched here (the /scores pipeline owns those). `upsertMarkets` keeps its
 * usual guarantees: settled markets/outcomes are never re-priced or
 * resurrected, stale feed outcomes get suspended.
 */
export async function upsertInPlayOdds(apiGames: ApiGame[]): Promise<{ updated: number }> {
  const priced = apiGames.filter((g) => g.inPlay && g.markets?.length);
  if (!priced.length) return { updated: 0 };

  const existingGames = await prisma.game.findMany({
    where: {
      externalId: { in: priced.map((g) => g.externalId) },
      // Live-ish rows only — SCHEDULED rows whose kickoff passed are in-play
      // but not yet flipped by the scores pipeline; refreshing their odds is
      // safe (upsertMarkets never writes status).
      status: { in: ["LIVE", "HALF_TIME", "IN_PLAY", "SCHEDULED"] },
    },
    select: { id: true, externalId: true, status: true, homeLogo: true, awayLogo: true },
  });
  const byExternalId = new Map(existingGames.map((g) => [g.externalId, g]));
  const targets = priced.filter((g) => byExternalId.has(g.externalId));
  if (!targets.length) return { updated: 0 };

  const marketRows = await prisma.market.findMany({
    where: { gameId: { in: targets.map((t) => byExternalId.get(t.externalId)!.id) } },
    include: { outcomes: true },
  });
  const marketsByGame = new Map<string, typeof marketRows>();
  for (const m of marketRows) {
    const list = marketsByGame.get(m.gameId) ?? [];
    list.push(m);
    marketsByGame.set(m.gameId, list);
  }

  for (const game of targets) {
    const existing = byExternalId.get(game.externalId)!;
    await upsertMarkets(existing.id, game, marketsByGame.get(existing.id) ?? []);
  }
  return { updated: targets.length };
}
