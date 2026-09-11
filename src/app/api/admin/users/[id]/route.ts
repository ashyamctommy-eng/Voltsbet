import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  status: z.string().optional(),
  verified: z.boolean().optional(),
  fullName: z.string().min(2).optional(),
  country: z.string().optional(),
});

/**
 * GET /api/admin/users/[id] — everything the expanded user row needs:
 * profile, balances, financial totals and the activity stream. Loaded lazily
 * when a row is expanded, so the list endpoint stays cheap.
 */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await sharedAdminGuard(req, "users");
  const { id } = await ctx.params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { wallet: true, _count: { select: { bets: true, deposits: true, withdrawals: true } } },
  });
  if (!user) throw new ApiError(404, "User not found.", "NOT_FOUND");

  const [txnSums, bets, transactions] = await Promise.all([
    // Sum the wallet ledger by type — the single source of truth for money in/out.
    prisma.transaction.groupBy({ by: ["type"], where: { userId: id }, _sum: { amount: true } }),
    prisma.bet.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { selections: { select: { marketName: true, outcomeName: true, oddsAtPlacement: true, result: true } } },
    }),
    prisma.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, method: true, amount: true, currencyCode: true, reason: true, reference: true, createdAt: true },
    }),
  ]);

  const sum = (t: string) => Number(txnSums.find((r) => r.type === t)?._sum.amount ?? 0);
  const totalDeposits = sum("DEPOSIT");
  const totalWithdrawals = sum("WITHDRAWAL");
  const totalStaked = sum("BET_STAKE");
  const totalReturns = sum("BET_WIN") + sum("BET_REFUND") + sum("CASH_OUT");
  const adjustments = sum("ADJUSTMENT");

  return ok({
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      country: user.country,
      status: user.status,
      verified: user.verified,
      role: user.role,
      currencyCode: user.currencyCode,
      hasDeposited: user.hasDeposited,
      referralCode: user.referralCode,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    wallet: {
      balance: user.wallet ? Number(user.wallet.balance) : 0,
      bonusBalance: user.wallet ? Number(user.wallet.bonusBalance) : 0,
      currencyCode: user.wallet?.currencyCode ?? user.currencyCode,
    },
    financials: {
      totalDeposits,
      totalWithdrawals,
      totalStaked,
      totalReturns,
      // Betting P&L from the customer's side: returns − stakes. Negative = house ahead.
      netPnl: totalReturns - totalStaked,
      adjustments,
      currencyCode: user.wallet?.currencyCode ?? user.currencyCode,
    },
    counts: user._count,
    bets: bets.map((b) => ({
      id: b.id,
      code: b.code,
      type: b.type,
      stake: Number(b.stake),
      totalOdds: Number(b.totalOdds),
      potentialWin: Number(b.potentialWin),
      status: b.status,
      createdAt: b.createdAt,
      selections: b.selections.map((s) => ({
        marketName: s.marketName,
        outcomeName: s.outcomeName,
        odds: Number(s.oddsAtPlacement),
        result: s.result,
      })),
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      method: t.method,
      amount: Number(t.amount),
      currencyCode: t.currencyCode,
      reason: t.reason,
      reference: t.reference,
      createdAt: t.createdAt,
    })),
  });
});

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "users");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const prev = await prisma.user.findUnique({ where: { id } });
  if (!prev) throw new ApiError(404, "User not found.", "NOT_FOUND");
  if (prev.role !== "CUSTOMER") throw new ApiError(403, "Cannot modify admin accounts here.", "FORBIDDEN");

  const user = await prisma.user.update({ where: { id }, data: parsed.data });
  await auditLog({
    admin, action: parsed.data.status && parsed.data.status !== prev.status ? "USER_STATUS_CHANGE" : "UPDATE",
    entity: "USER", entityId: id, userId: id,
    prevValue: { status: prev.status, verified: prev.verified },
    newValue: { status: user.status, verified: user.verified },
  });

  if (parsed.data.status && parsed.data.status !== prev.status) {
    // Suspending (or otherwise deactivating) a user must kill every live
    // session immediately — otherwise a logged-in abuser keeps full access
    // until their cookie expires.
    if (user.status !== "ACTIVE") {
      await prisma.session.deleteMany({ where: { userId: id } });
    }
    await prisma.notification.create({
      data: {
        userId: id, type: "ACCOUNT",
        title: parsed.data.status === "ACTIVE" ? "Account Reactivated" : `Account ${user.status.replace("_", " ").toLowerCase()}`,
        message: `Your account status changed to ${user.status.replace("_", " ").toLowerCase()}.`,
      },
    });
  }
  return ok({ user });
});

export const DELETE = handle(async () => {
  throw new ApiError(405, "Users are suspended, not deleted.", "NOT_ALLOWED");
});
