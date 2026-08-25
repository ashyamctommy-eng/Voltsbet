/**
 * Sync service — pulls from the configured provider and upserts into the DB.
 * Dedup via Game.externalId (unique). Idempotent: repeated runs never
 * duplicate games, and odds are updated in place.
 *
 * Wire-up options:
 *   1. Cron: run this module on a schedule (node-cron / system cron / Railway cron).
 *   2. On-demand: POST /api/admin/sync (admin button).
 *   3. Interval loop inside the Next.js server (simplest for a single instance).
 */
import { prisma } from "@/lib/prisma";
import { TheOddsApi, OddsProvider, ApiGame } from "@/lib/providers/odds-api";
import { teamLogo } from "@/lib/team-logos";
import { getSettings, setSetting } from "@/lib/settings";
import { deriveDoubleChance, deriveDrawNoBet } from "@/lib/derived-markets";
import { ApiFootballProvider } from "@/lib/providers/api-football";
import { LEAGUE_TITLES } from "@/lib/feed";

export const PROVIDERS: Record<string, () => OddsProvider> = {
  "the-odds-api": () => new TheOddsApi(), // primary — free 500 req/month, clean h2h/totals
  "api-football": () => new ApiFootballProvider(), // API-Football — 100 req/day, global + African leagues
};

/** Env var that gates each provider — checked before syncing so a missing key
 *  never silently skips (and never blocks the other provider). */
export const PROVIDER_KEY_ENV: Record<string, string> = {
  "the-odds-api": "ODDS_API_KEY",
  "api-football": "ODDS_API_IO_KEY",
};

// Map provider sport keys → local sport slugs. Extend per your feed.
// Keys verified against the live API (2026-08): The Odds API renamed several
// keys (soccer_la_liga → soccer_spain_la_liga, etc.). Tennis is now
// tournament-specific (tennis_atp_cincinnati_open, …) and cricket_ipl only
// exists during its season — add them back when in season, as needed.
const SPORT_KEY_MAP: Record<string, string> = {
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
  football: "football", // api-football (API-Football) sport key
  basketball_nba: "basketball",
  baseball_mlb: "baseball", icehockey_nhl: "ice-hockey",
  "3": "basketball", "2": "tennis", "4": "ice-hockey", // betsapi sport ids
};

/** Resolve the sync roles: pre-match source and live source. Each role falls
 *  back to the legacy primary (odds.provider), then to BetsAPI. */
export function resolveSyncRoles(s: {
  oddsPrematchProvider?: string;
  oddsLiveProvider?: string;
  oddsProvider?: string;
}): { prematch: string; live: string } {
  const primary = s.oddsProvider || "betsapi";
  return {
    prematch: s.oddsPrematchProvider || primary,
    live: s.oddsLiveProvider || primary,
  };
}

export async function syncGames(providerId?: string) {
  const s = await getSettings();
  // Per-provider roles: a pre-match source (fixtures + prematch odds) and a
  // live source (in-play scores/timers). Empty = follow the primary.
  // Passing providerId forces both roles to that single provider.
  const roles = providerId ? { prematch: providerId, live: providerId } : resolveSyncRoles(s);
  const provider = PROVIDERS[roles.prematch]?.();
  const liveSource = PROVIDERS[roles.live]?.();
  if (!provider) throw new Error(`Unknown pre-match provider: ${roles.prematch}`);
  if (!liveSource) throw new Error(`Unknown live provider: ${roles.live}`);

  // Key guard per role — BetsAPI creds live in the DB (Admin → API Settings);
  // other providers are gated by their env key.
  const missingKey = (id: string): string | null => {
    if (id === "betsapi") return s.apiRapidKey ? null : "RapidAPI key not configured — set it in Admin → API Settings";
    const keyEnv = PROVIDER_KEY_ENV[id] ?? "ODDS_API_KEY";
    return process.env[keyEnv] ? null : `${keyEnv} not set — keeping manual/seed games`;
  };
  const prematchMissing = missingKey(roles.prematch);
  if (prematchMissing) return { skipped: true, reason: prematchMissing };
  // A missing live-source key degrades gracefully: pre-match still syncs.
  const liveConfigured = !missingKey(roles.live);

  const sports = await provider.fetchSports();
  const wanted = sports.filter((s) => SPORT_KEY_MAP[s.key]);
  const sportKeys = wanted.map((s) => s.key);

  const [games, scores] = await Promise.all([
    provider.fetchUpcomingGames(sportKeys),
    liveConfigured ? liveSource.fetchLiveScores(sportKeys) : Promise.resolve([]),
  ]);

  let created = 0, updated = 0;
  for (const game of games) {
    const sportSlug = SPORT_KEY_MAP[game.sportKey];
    const sport = await prisma.sport.findUnique({ where: { slug: sportSlug } });
    if (!sport) continue;

    const existing = await prisma.game.findUnique({ where: { externalId: game.externalId } });
    const payload = await buildPayload(game, sport.id, existing ?? undefined);

    if (existing) {
      await prisma.game.update({ where: { id: existing.id }, data: payload.game });
      await upsertMarkets(existing.id, game);
      updated++;
    } else {
      const createdGame = await prisma.game.create({
        data: { ...payload.game, externalId: game.externalId, source: "API" },
      });
      await upsertMarkets(createdGame.id, game);
      created++;
    }
  }

  // Apply live scores / final results
  let scoreUpdates = 0;
  for (const score of scores) {
    const game = await prisma.game.findUnique({ where: { externalId: score.externalId } });
    if (!game) continue;
    await prisma.game.update({
      where: { id: game.id },
      data: {
        ...(score.homeScore !== undefined ? { homeScore: score.homeScore } : {}),
        ...(score.awayScore !== undefined ? { awayScore: score.awayScore } : {}),
        status: score.status === "finished" ? "FINISHED" : score.status === "live" ? "LIVE" : game.status,
        ...(score.status === "live" ? { live: true, clock: score.clock ?? null, period: score.period ?? null } : {}),
      },
    });
    scoreUpdates++;
  }

  // Optional settlement sweep — providers with fetchResults() (betsapi) pull
  // finished outcomes for due games that aren't finished yet. Capped so the
  // request budget stays sane on rate-limited plans.
  if (provider.fetchResults && roles.prematch === "betsapi") {
    const due = await prisma.game.findMany({
      where: {
        source: "API",
        externalId: { startsWith: "betsapi-" },
        startAt: { lt: new Date() },
        status: { notIn: ["FINISHED", "CANCELLED", "POSTPONED"] },
      },
      select: { externalId: true },
      take: 20,
    });
    if (due.length) {
      const ids = due
        .map((g) => g.externalId)
        .filter((id): id is string => !!id);
      const finished = await provider.fetchResults(ids);
      for (const score of finished) {
        const game = await prisma.game.findUnique({ where: { externalId: score.externalId } });
        if (!game) continue;
        await prisma.game.update({
          where: { id: game.id },
          data: {
            ...(score.homeScore !== undefined ? { homeScore: score.homeScore } : {}),
            ...(score.awayScore !== undefined ? { awayScore: score.awayScore } : {}),
            status: "FINISHED",
            live: false,
          },
        });
        scoreUpdates++;
      }
    }
  }

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
    scoreUpdates,
    gamesSynced: games.length,
    prematchProvider: roles.prematch,
    liveProvider: roles.live,
    liveConfigured,
  };
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
      source: "API",
    },
  };
}

async function upsertMarkets(gameId: string, game: ApiGame) {
  // h2h → MATCH_RESULT (1/X/2 for soccer), totals → OVER_UNDER
  for (const [i, m] of game.markets.entries()) {
    const existing = await prisma.market.findFirst({
      where: { gameId, key: m.key },
      include: { outcomes: true },
    });
    if (existing) {
      // Update odds in place; suspend outcomes no longer in the feed
      for (const o of m.outcomes) {
        const outcome = existing.outcomes.find((x) => x.name === o.name);
        if (outcome) {
          await prisma.outcome.update({
            where: { id: outcome.id },
            data: { odds: o.odds.toFixed(2), status: "ACTIVE" },
          });
        } else {
          await prisma.outcome.create({
            data: { marketId: existing.id, name: o.name, label: o.label ?? null, odds: o.odds.toFixed(2) },
          });
        }
      }
    } else {
      await prisma.market.create({
        data: {
          gameId,
          name: m.name,
          key: m.key,
          sortOrder: i,
          outcomes: { create: m.outcomes.map((o, j) => ({ name: o.name, label: o.label ?? null, odds: o.odds.toFixed(2), sortOrder: j })) },
        },
      });
    }

    // Derive extra bettable markets from any 3-way h2h (Double Chance, Draw No Bet)
    if (m.key === "MATCH_RESULT" || m.key === "h2h") {
      await upsertDerived(gameId, m, game.homeName, game.awayName);
    }
  }
}

/** Upsert a derived market (DOUBLE_CHANCE / DRAW_NO_BET) from an h2h market. */
async function upsertDerived(
  gameId: string,
  source: { key: string; name: string; outcomes: { name: string; label?: string | null; odds: number }[] },
  homeName: string,
  awayName: string,
) {
  const derived: { key: string; name: string; outcomes: { name: string; odds: string }[] | null }[] = [
    { key: "DOUBLE_CHANCE", name: "Double Chance", outcomes: deriveDoubleChance(source.outcomes, homeName, awayName) },
    { key: "DRAW_NO_BET", name: "Draw No Bet", outcomes: deriveDrawNoBet(source.outcomes, homeName, awayName) },
  ];
  for (const d of derived) {
    if (!d.outcomes) continue; // not a 3-way market (e.g. NBA moneyline)
    const existing = await prisma.market.findFirst({ where: { gameId, key: d.key }, include: { outcomes: true } });
    if (existing) {
      for (const o of d.outcomes) {
        const outcome = existing.outcomes.find((x) => x.name === o.name);
        if (outcome) {
          await prisma.outcome.update({ where: { id: outcome.id }, data: { odds: o.odds, status: "ACTIVE" } });
        } else {
          await prisma.outcome.create({ data: { marketId: existing.id, name: o.name, odds: o.odds } });
        }
      }
    } else {
      await prisma.market.create({
        data: {
          gameId,
          name: d.name,
          key: d.key,
          sortOrder: 10,
          outcomes: { create: d.outcomes.map((o, j) => ({ name: o.name, odds: o.odds, sortOrder: j })) },
        },
      });
    }
  }
}
