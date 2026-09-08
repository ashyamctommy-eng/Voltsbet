import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { LIVE_STATUSES } from "@/lib/game-status";

/**
 * Admin live alert — how many REAL manual fixtures are stuck "live" and
 * need finishing (Admin → Games → finish/settle). Read-only count.
 *
 * Classifier mirrors lib/orphan-live.ts: a row the API can never update
 * (externalId null) that is still in a live status well after kickoff and
 * is either admin-created (has an isManual market) or carries bet history
 * (so it must never be auto-deleted) → the admin should finish it.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "games");
  const ageHours = Number(process.env.LIVE_ORPHAN_AGE_HOURS ?? 6) || 6;
  const cutoff = new Date(Date.now() - ageHours * 3600_000);

  const [stuckManual, orphanSeeds] = await Promise.all([
    prisma.game.count({
      where: {
        externalId: null,
        status: { in: [...LIVE_STATUSES] },
        startAt: { lt: cutoff },
        OR: [{ selections: { some: {} } }, { markets: { some: { isManual: true } } }],
      },
    }),
    prisma.game.count({
      where: {
        externalId: null,
        status: { in: [...LIVE_STATUSES] },
        startAt: { lt: cutoff },
        selections: { none: {} },
        markets: { none: { isManual: true } },
      },
    }),
  ]);

  return ok({
    stuckManual,
    orphanSeeds,
    ageHours,
    message:
      stuckManual > 0
        ? `${stuckManual} manual live game${stuckManual > 1 ? "s" : ""} started over ${ageHours}h ago — open Admin → Games and finish/settle it.`
        : null,
  });
});
