import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Admin deposit list + reconciliation summary.
 *
 * ?status=<STATUS>  filter to one status
 * ?status=STALE     pseudo-filter: deposits still in a creditable state
 *                   (AWAITING_PAYMENT/PAYMENT_DETECTED/CONFIRMING/CONFIRMED)
 *                   whose payment window has expired but which the purge cron
 *                   hasn't flipped to EXPIRED yet — the exact rows needing
 *                   reconciliation attention.
 *
 * Every response carries `summary`: per-status counts + stale count + the
 * value of expired deposits in the last 7 days — the audit surface for
 * deposit-expiry reconciliation.
 */
const CREDITABLE = ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING", "CONFIRMED"];

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "deposits");
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const now = new Date();

  const where =
    status === "STALE"
      ? { status: { in: CREDITABLE }, expiresAt: { lt: now } }
      : status
        ? { status }
        : {};

  const [deposits, byStatus, staleCount, expiredWeek] = await Promise.all([
    prisma.deposit.findMany({
      where,
      include: { user: { select: { username: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.deposit.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.deposit.count({ where: { status: { in: CREDITABLE }, expiresAt: { lt: now } } }),
    prisma.deposit.aggregate({
      where: { status: "EXPIRED", createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
      _count: { _all: true },
    }),
  ]);

  return ok({
    deposits,
    summary: {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      stale: staleCount, // creditable but past expiry — cron hasn't swept them
      expiredLast7d: expiredWeek._count._all,
    },
  });
});

export const PATCH = handle(async () => {
  throw new ApiError(404, "Not found.", "NOT_FOUND");
});
