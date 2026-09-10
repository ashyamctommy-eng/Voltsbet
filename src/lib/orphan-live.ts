import { prisma } from "./prisma";
import { LIVE_STATUSES } from "./game-status";

/**
 * Orphan live-row reconciliation.
 *
 * Rows the provider can never update again — no `externalId` (seeded demo
 * games, or anything created outside the API pipeline) — stay stuck in
 * LIVE/HALF_TIME/IN_PLAY forever with frozen clocks: /scores matches by
 * externalId and purge skips "live" statuses.
 *
 * This guard deletes ONLY provably-fake leftovers:
 *   - no externalId,
 *   - still "live" well after kickoff (default 6h, LIVE_ORPHAN_AGE_HOURS),
 *   - ZERO bet selections (bet history must never be deleted),
 *   - ZERO admin-created (isManual) markets — a real manual fixture an
 *     admin built is left alone and reported via `stuckManual` so the admin
 *     UI can nudge them to finish it properly (Admin → Games).
 *
 * Called from the live-scores sweep (whenever /live is opened or the sync
 * cron runs) and the daily purge cron, so seeded demo matches disappear on
 * their own once the API pipeline is healthy — no manual SQL required.
 */
export type OrphanLiveResult = { orphanDeleted: number; stuckManual: number; staleFinished: number };

const DEFAULT_AGE_HOURS = Number(process.env.LIVE_ORPHAN_AGE_HOURS ?? 6) || 6;
/** A real (externalId) row still "live" this long after kickoff is a stuck
 *  feed event — force-finish it so it stops ticking and gets settled. */
const STALE_FINISH_HOURS = Number(process.env.LIVE_STALE_FINISH_HOURS ?? 4) || 4;

/** Force-finish stuck API live rows (externalId present) older than the
 *  window. Manual/seed rows are deliberately NOT touched here — genuine
 *  manual fixtures go through the admin alert FAB → Admin → Games. */
export async function finishStaleLiveGames(ageHours = STALE_FINISH_HOURS): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - ageHours * 3600_000);
    const res = await prisma.game.updateMany({
      where: {
        externalId: { not: null },
        status: { in: [...LIVE_STATUSES] },
        startAt: { lt: cutoff },
      },
      data: { status: "FINISHED", live: false, clock: null, period: null },
    });
    if (res.count) {
      console.warn(`[orphan-live] force-finished ${res.count} stale live API game(s) older than ${ageHours}h`);
    }
    return res.count;
  } catch (e) {
    console.error("[orphan-live] stale-finish failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function reconcileOrphanLiveGames(
  ageHours = DEFAULT_AGE_HOURS,
): Promise<OrphanLiveResult> {
  try {
    const cutoff = new Date(Date.now() - ageHours * 3600_000);
    const candidates = await prisma.game.findMany({
      where: {
        externalId: null,
        status: { in: [...LIVE_STATUSES] },
        startAt: { lt: cutoff },
      },
      select: {
        id: true,
        _count: {
          select: {
            selections: true,
            markets: { where: { isManual: true } },
          },
        },
      },
      take: 500,
    });

    const deletable: string[] = [];
    let stuckManual = 0;
    for (const g of candidates) {
      if (g._count.selections === 0 && g._count.markets === 0) deletable.push(g.id);
      else stuckManual++;
    }

    let orphanDeleted = 0;
    if (deletable.length) {
      const del = await prisma.game.deleteMany({ where: { id: { in: deletable } } });
      orphanDeleted = del.count;
    }
    // Spec'd auto-cleanup: stale API live rows → FINISHED (4h default).
    const staleFinished = await finishStaleLiveGames();
    return { orphanDeleted, stuckManual, staleFinished };
  } catch (e) {
    // Cleanup must never take the live sweep or purge cron down.
    console.error("[orphan-live] reconcile failed:", e instanceof Error ? e.message : e);
    return { orphanDeleted: 0, stuckManual: 0, staleFinished: 0 };
  }
}
