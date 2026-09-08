import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Admin M-Pesa transactions feed — STK push deposits + B2C withdrawals on
 * the M-Pesa rail (both the Palplus gateway and the legacy Daraja path).
 * Read-only: reconciliation happens on /admin/deposits & /admin/withdrawals.
 */
export const dynamic = "force-dynamic";

const TAKE = 100;

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "mpesa");

  const [deposits, withdrawals] = await Promise.all([
    prisma.deposit.findMany({
      where: { OR: [{ method: "MPESA" }, { provider: "PALPLUS" }] },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      include: { user: { select: { username: true, email: true } } },
    }),
    prisma.withdrawal.findMany({
      where: { method: "MPESA" },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      include: { user: { select: { username: true, email: true } } },
    }),
  ]);

  const rows = [
    ...deposits.map((d) => ({
      kind: "DEPOSIT" as const,
      id: d.id,
      ref: `DEP-${d.id.slice(-6)}`,
      user: d.user,
      amount: Number(d.amount),
      currencyCode: d.currencyCode,
      provider: d.provider === "PALPLUS" ? "PALPLUS" : "MPESA",
      status: d.status,
      createdAt: d.createdAt,
    })),
    ...withdrawals.map((w) => ({
      kind: "WITHDRAWAL" as const,
      id: w.id,
      ref: w.trackingId ?? `WD-${w.id.slice(-6)}`,
      user: w.user,
      amount: Number(w.amount),
      currencyCode: w.currencyCode,
      provider: "MPESA",
      status: w.status,
      createdAt: w.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, TAKE);

  const creditedByCurrency = new Map<string, number>();
  for (const d of deposits) {
    if (d.status === "COMPLETED") {
      creditedByCurrency.set(d.currencyCode, (creditedByCurrency.get(d.currencyCode) ?? 0) + Number(d.amount));
    }
  }
  const paidOutByCurrency = new Map<string, number>();
  for (const w of withdrawals) {
    if (w.status === "COMPLETED") {
      paidOutByCurrency.set(w.currencyCode, (paidOutByCurrency.get(w.currencyCode) ?? 0) + Number(w.amount));
    }
  }

  return ok({
    rows,
    summary: {
      stkPushes: deposits.length,
      b2cPayouts: withdrawals.length,
      credited: Object.fromEntries(creditedByCurrency),
      paidOut: Object.fromEntries(paidOutByCurrency),
      pendingPayouts: withdrawals.filter((w) => ["PENDING", "PROCESSING", "VERIFICATION_REQUIRED"].includes(w.status)).length,
    },
  });
});
