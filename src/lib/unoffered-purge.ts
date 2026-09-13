/**
 * Remove upcoming fixtures for sports the book does not offer.
 *
 * Why this exists: the paid sync used to run in catalog mode (every sport The
 * Odds API lists) before a League Sync whitelist was saved. Those rows are
 * source=API with real prices, so the seeded-games toggle cannot hide them —
 * they legitimately look synced. They linger as bettable inventory the operator
 * never wanted, at prices that will never refresh again.
 *
 * The built-in /api/cron/purge job is NOT this: it deletes fixtures that
 * STARTED more than PURGE_MAX_AGE_HOURS ago (past-match housekeeping), so it
 * correctly deletes none of these — they are all in the future.
 *
 * Safety model (each rule exists because removing it loses money or data):
 *  1. "Offered" is derived from the sync whitelist, never hardcoded. Empty
 *     whitelist = catalog mode = every sport is offered → refuse to purge.
 *  2. Only source=API. Operator-created (MANUAL) rows are never touched.
 *  3. Only upcoming, non-started games. LIVE/HALF_TIME/FINISHED are left alone.
 *  4. Any game carrying a bet selection is excluded and reported. The DB also
 *     declares BetSelection.game as onDelete: Restrict, so even a bug here
 *     cannot silently delete a customer's bet — the delete would throw.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { resolveSportSlug } from "@/lib/sync";

/** Statuses that are under way or already resolved — never purgeable. */
const KEEP_STATUSES = ["LIVE", "HALF_TIME", "IN_PLAY", "FINISHED", "CANCELLED"];

export type PurgePlan = {
  /** null = not purged-able; `reason` explains why. */
  offeredSports: { slug: string; name: string; games: number }[];
  counts: { slug: string; name: string; games: number }[];
  total: number;
  /** Skipped because a customer has a bet on them. */
  protectedCount: number;
  sample: { home: string; away: string; sport: string; startAt: string }[];
  /** Total credits the original fetch of these games cost, if known. */
  refused: { reason: string } | null;
};

/** Which sports the book actually syncs, from the League Sync whitelist. */
export async function offeredSportSlugs(): Promise<string[]> {
  const s = await getSettings();
  const whitelist = s.oddsSyncLeagues ?? [];
  return [...new Set(whitelist.map((k) => resolveSportSlug(k)))];
}

export async function planUnofferedPurge(): Promise<PurgePlan> {
  const offered = await offeredSportSlugs();
  if (!offered.length) {
    return {
      offeredSports: [],
      counts: [],
      total: 0,
      protectedCount: 0,
      sample: [],
      refused: {
        reason:
          "No League Sync whitelist is saved, so the book is in catalog mode and every sport counts as offered. Save a whitelist first — purging now would delete everything.",
      },
    };
  }

  const sports = await prisma.sport.findMany({ select: { id: true, slug: true, name: true } });
  const offeredIds = sports.filter((sp) => offered.includes(sp.slug)).map((sp) => sp.id);
  const offeredSports = sports
    .filter((sp) => offered.includes(sp.slug))
    .map((sp) => ({ slug: sp.slug, name: sp.name, games: 0 }));

  const candidates = await prisma.game.findMany({
    where: {
      source: "API",
      startAt: { gt: new Date() },
      status: { notIn: KEEP_STATUSES },
      ...(offeredIds.length ? { sportId: { notIn: offeredIds } } : {}),
    },
    select: {
      id: true,
      homeName: true,
      awayName: true,
      startAt: true,
      sport: { select: { slug: true, name: true } },
    },
    orderBy: { startAt: "asc" },
  });

  const ids = candidates.map((c) => c.id);
  const protectedIds = new Set<string>();
  if (ids.length) {
    const rows = await prisma.betSelection.findMany({
      where: { gameId: { in: ids } },
      select: { gameId: true },
      distinct: ["gameId"],
    });
    for (const r of rows) protectedIds.add(r.gameId);
  }

  const deletable = candidates.filter((c) => !protectedIds.has(c.id));
  const bySlug = new Map<string, { slug: string; name: string; games: number }>();
  for (const g of deletable) {
    const key = g.sport.slug;
    const row = bySlug.get(key) ?? { slug: key, name: g.sport.name, games: 0 };
    row.games += 1;
    bySlug.set(key, row);
  }

  // Real fixture counts per offered sport, so the operator can see what is kept.
  const keptCounts = await prisma.game.groupBy({
    by: ["sportId"],
    where: { sportId: { in: offeredIds }, startAt: { gt: new Date() } },
    _count: { _all: true },
  });
  const keptBySportId = new Map(keptCounts.map((k) => [k.sportId, k._count._all]));
  for (const o of offeredSports) {
    const sport = sports.find((sp) => sp.slug === o.slug);
    o.games = (sport && keptBySportId.get(sport.id)) || 0;
  }

  return {
    offeredSports,
    counts: [...bySlug.values()].sort((a, b) => b.games - a.games),
    total: deletable.length,
    protectedCount: protectedIds.size,
    sample: deletable.slice(0, 8).map((g) => ({
      home: g.homeName,
      away: g.awayName,
      sport: g.sport.name,
      startAt: g.startAt.toISOString(),
    })),
    refused: null,
  };
}

export async function executeUnofferedPurge(): Promise<{ deleted: number; protectedCount: number }> {
  // Recompute rather than trusting an id list from the client: the world may
  // have changed (a game kicked off, a bet was placed) since the preview.
  const plan = await planUnofferedPurge();
  if (plan.refused || plan.total === 0) return { deleted: 0, protectedCount: plan.protectedCount };

  const offered = await offeredSportSlugs();
  const sports = await prisma.sport.findMany({ select: { id: true, slug: true } });
  const offeredIds = sports.filter((sp) => offered.includes(sp.slug)).map((sp) => sp.id);

  const removable = await prisma.game.findMany({
    where: {
      source: "API",
      startAt: { gt: new Date() },
      status: { notIn: KEEP_STATUSES },
      ...(offeredIds.length ? { sportId: { notIn: offeredIds } } : {}),
    },
    select: { id: true, _count: { select: { markets: true } } },
  });
  const ids = removable.map((g) => g.id);
  if (!ids.length) return { deleted: 0, protectedCount: plan.protectedCount };

  // Belt and braces alongside the DB's Restrict: never hand a game with a
  // selection to deleteMany.
  const withBets = await prisma.betSelection.findMany({
    where: { gameId: { in: ids } },
    select: { gameId: true },
    distinct: ["gameId"],
  });
  const blocked = new Set(withBets.map((r) => r.gameId));
  const deletable = ids.filter((id) => !blocked.has(id));

  const res = await prisma.game.deleteMany({ where: { id: { in: deletable } } });
  return { deleted: res.count, protectedCount: blocked.size };
}
