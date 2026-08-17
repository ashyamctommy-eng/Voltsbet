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

export const PROVIDERS: Record<string, () => OddsProvider> = {
  "the-odds-api": () => new TheOddsApi(),
};

// Map provider sport keys → local sport slugs. Extend per your feed.
// Keys verified against the live API (2026-08): The Odds API renamed several
// keys (soccer_la_liga → soccer_spain_la_liga, etc.). Tennis is now
// tournament-specific (tennis_atp_cincinnati_open, …) and cricket_ipl only
// exists during its season — add them back when in season, as needed.
const SPORT_KEY_MAP: Record<string, string> = {
  soccer_epl: "football", soccer_spain_la_liga: "football",
  soccer_italy_serie_a: "football", soccer_germany_bundesliga: "football",
  basketball_nba: "basketball",
  baseball_mlb: "baseball", icehockey_nhl: "ice-hockey",
};

export async function syncGames(providerId = "the-odds-api") {
  const provider = PROVIDERS[providerId]?.();
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  if (!process.env.ODDS_API_KEY) {
    return { skipped: true, reason: "ODDS_API_KEY not set — keeping manual/seed games" };
  }

  const sports = await provider.fetchSports();
  const wanted = sports.filter((s) => SPORT_KEY_MAP[s.key]);
  const sportKeys = wanted.map((s) => s.key);

  const [games, scores] = await Promise.all([
    provider.fetchUpcomingGames(sportKeys),
    provider.fetchLiveScores(sportKeys),
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

  return { created, updated, scoreUpdates, gamesSynced: games.length };
}

async function buildPayload(
  game: ApiGame,
  sportId: string,
  existing?: { homeLogo: string | null; awayLogo: string | null },
) {
  return {
    game: {
      sportId,
      competitionName: game.competitionName ?? null,
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
  }
}
