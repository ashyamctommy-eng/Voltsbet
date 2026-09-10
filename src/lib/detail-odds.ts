/**
 * TIER 2 — on-demand match-detail odds.
 *
 * The bulk sweep deliberately prices only the cheap list markets plus the
 * per-event pass for a few featured leagues. When a user opens a match detail
 * page we fetch the DEEP menu for that single event
 * (`/v4/sports/{sport}/events/{eventId}/odds`) and cache the result in the DB
 * for `soccer.detailCacheTtlSeconds` (default 45s, env
 * `SOCCER_DETAIL_CACHE_TTL_SECONDS`).
 *
 * Cost control:
 *  - one request per event per TTL window (marker `detail.oddsAt.<gameId>`);
 *  - concurrent requests for the same game share one in-flight promise;
 *  - a failure never throws to the page — the cached/DB markets are served.
 */
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { LEAGUE_TITLES } from "./league-titles";
import { TheOddsApi } from "./providers/odds-api";
import { upsertMarkets } from "./sync";

export const DEFAULT_DETAIL_MARKETS = [
  "alternate_totals",
  "alternate_spreads",
  "h2h_h1",
  "h2h_h2",
  "team_totals",
];

export type DetailMarkets = Awaited<ReturnType<typeof loadDetailMarkets>>;

/** Deep market menu for the detail tier (env > DB > default). */
async function loadDetailMarkets(): Promise<string[]> {
  const env = process.env.SOCCER_DETAIL_MARKETS?.split(",").map((x) => x.trim()).filter(Boolean);
  if (env?.length) return env;
  const s = await getSettings();
  return s.soccerDetailMarkets.length ? s.soccerDetailMarkets : DEFAULT_DETAIL_MARKETS;
}

/** TTL in seconds (env > DB > 45). */
async function detailTtlSeconds(): Promise<number> {
  const env = Number(process.env.SOCCER_DETAIL_CACHE_TTL_SECONDS);
  if (Number.isFinite(env) && env >= 5) return Math.min(3600, Math.round(env));
  const s = await getSettings();
  return s.soccerDetailCacheTtlSeconds;
}

/** Pure cache-freshness decision (unit-tested). */
export function isDetailFresh(fetchedAtMs: number | null, ttlSeconds: number, now: number = Date.now()): boolean {
  if (!fetchedAtMs || !Number.isFinite(fetchedAtMs)) return false;
  return now - fetchedAtMs < Math.max(1, ttlSeconds) * 1000;
}

// Title → sport key reverse map, enriched once from the quota-free /sports list.
let titleMap: { at: number; map: Map<string, string> } | null = null;
async function competitionToSportKey(competitionName: string | null): Promise<string | null> {
  if (!competitionName) return null;
  const direct = Object.entries(LEAGUE_TITLES).find(([, title]) => title === competitionName)?.[0];
  if (direct) return direct;
  if (!titleMap || Date.now() - titleMap.at > 10 * 60_000) {
    try {
      const sports = await new TheOddsApi().fetchSports(); // 0 credits
      titleMap = { at: Date.now(), map: new Map(sports.map((s) => [s.name, s.key])) };
    } catch {
      return null;
    }
  }
  return titleMap.map.get(competitionName) ?? null;
}

const inFlight = new Map<string, Promise<DetailResult>>();

export type DetailResult = {
  gameId: string | null;
  markets: Awaited<ReturnType<typeof readMarkets>>;
  source: "cache" | "api" | "unavailable";
  fetchedAt: number | null;
  ttlSeconds: number;
  detailMarkets: string[];
};

async function readMarkets(gameId: string) {
  return prisma.market.findMany({
    where: { gameId },
    include: { outcomes: true },
    orderBy: { sortOrder: "asc" },
  });
}

async function readMarker(gameId: string): Promise<number | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: `detail.oddsAt.${gameId}` } });
    const n = row ? Number(row.value) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function writeMarker(gameId: string, atMs: number): Promise<void> {
  try {
    const value = String(atMs);
    await prisma.setting.upsert({
      where: { key: `detail.oddsAt.${gameId}` },
      update: { value },
      create: { key: `detail.oddsAt.${gameId}`, value },
    });
  } catch {
    /* cache marker is an optimisation */
  }
}

/**
 * Ensure a game's deep markets are fresh, then return them.
 * Accepts either the internal game id or the API `externalId`.
 */
export async function refreshDetailMarkets(
  idOrExternalId: string,
  opts: { force?: boolean } = {},
): Promise<DetailResult> {
  const ttlSeconds = await detailTtlSeconds();
  const detailMarkets = await loadDetailMarkets();

  const game = await prisma.game.findFirst({
    where: { OR: [{ id: idOrExternalId }, { externalId: idOrExternalId }] },
    select: { id: true, externalId: true, competitionName: true, homeName: true, awayName: true, sportId: true },
  });

  if (!game) {
    return { gameId: null, markets: [], source: "unavailable", fetchedAt: null, ttlSeconds, detailMarkets };
  }

  const markerAt = await readMarker(game.id);
  if (!opts.force && isDetailFresh(markerAt, ttlSeconds)) {
    return { gameId: game.id, markets: await readMarkets(game.id), source: "cache", fetchedAt: markerAt, ttlSeconds, detailMarkets };
  }

  // Manual/seed rows have no API id — nothing to fetch.
  if (!game.externalId || !detailMarkets.length) {
    return {
      gameId: game.id,
      markets: await readMarkets(game.id),
      source: "unavailable",
      fetchedAt: markerAt,
      ttlSeconds,
      detailMarkets,
    };
  }

  const externalId = game.externalId; // narrowed for the async closure below
  const existing = inFlight.get(game.id);
  if (existing) return existing;

  const run = (async (): Promise<DetailResult> => {
    try {
      const sportKey = await competitionToSportKey(game.competitionName);
      if (!sportKey) {
        return { gameId: game.id, markets: await readMarkets(game.id), source: "unavailable", fetchedAt: markerAt, ttlSeconds, detailMarkets };
      }
      const provider = new TheOddsApi();
      const apiGames = await provider.fetchEventMarkets(
        [{ sportKey, eventId: externalId, homeName: game.homeName, awayName: game.awayName }],
        detailMarkets,
      );
      const priced = apiGames.find((g) => g.externalId === externalId && g.markets?.length);
      if (!priced) {
        // Provider had nothing (delisted/kicked off) — remember the attempt so
        // the TTL window absorbs repeated page loads instead of re-requesting.
        await writeMarker(game.id, Date.now());
        return { gameId: game.id, markets: await readMarkets(game.id), source: "unavailable", fetchedAt: Date.now(), ttlSeconds, detailMarkets };
      }
      await upsertMarkets(game.id, priced, await readMarkets(game.id));
      const at = Date.now();
      await writeMarker(game.id, at);
      return { gameId: game.id, markets: await readMarkets(game.id), source: "api", fetchedAt: at, ttlSeconds, detailMarkets };
    } catch (e) {
      console.warn(`[detail-odds] ${game.externalId} fetch failed:`, e instanceof Error ? e.message : e);
      return { gameId: game.id, markets: await readMarkets(game.id), source: "unavailable", fetchedAt: markerAt, ttlSeconds, detailMarkets };
    } finally {
      inFlight.delete(game.id);
    }
  })();

  inFlight.set(game.id, run);
  return run;
}
