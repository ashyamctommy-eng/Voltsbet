/**
 * Remove upcoming fixtures for sports the book does not offer.
 *
 *   GET  — preview: what WOULD be deleted, grouped by sport, plus a sample and
 *          how many rows are protected by existing bets. Nothing is written.
 *   POST — execute. Requires `{ confirm: "PURGE" }` so a stray fetch can never
 *          destroy inventory, and recomputes the plan server-side rather than
 *          trusting ids from the browser.
 *
 * See lib/unoffered-purge for why the existing /api/cron/purge does not do this
 * (it deletes PAST fixtures; these are future ones).
 */
import { NextRequest } from "next/server";
import { handle, ok, ApiError, auditLog, sharedAdminGuard } from "@/lib/api";
import { planUnofferedPurge, executeUnofferedPurge } from "@/lib/unoffered-purge";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "games");
  return ok(await planUnofferedPurge());
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "games");
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "PURGE") {
    throw new ApiError(400, 'Send { "confirm": "PURGE" } to confirm this deletes fixtures.', "CONFIRM_REQUIRED");
  }
  const plan = await planUnofferedPurge();
  if (plan.refused) throw new ApiError(409, plan.refused.reason, "REFUSED");
  const result = await executeUnofferedPurge();
  await auditLog({
    admin,
    action: "PURGE",
    entity: "GAME",
    entityId: "unoffered-sports",
    newValue: { ...result, sports: plan.counts },
  });
  return ok({ ...result, message: `Removed ${result.deleted} unoffered fixture(s).` });
});
