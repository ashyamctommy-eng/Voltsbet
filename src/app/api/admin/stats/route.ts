import { handle, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async () => {
  await requireAdmin("dashboard");

  const [totalUsers, activeUsers, newRegistrations, totalDeposits, totalWithdrawals,
    totalStakes, openBets, winningBets, losingBets, pendingWithdrawals, pendingDeposits,
    activeGames, liveGames, revenue] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
    prisma.transaction.aggregate({ where: { type: "DEPOSIT" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: "WITHDRAWAL" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: "BET_STAKE" }, _sum: { amount: true } }),
    prisma.bet.count({ where: { status: "OPEN" } }),
    prisma.bet.count({ where: { status: "WON" } }),
    prisma.bet.count({ where: { status: "LOST" } }),
    prisma.withdrawal.count({ where: { status: "PENDING" } }),
    prisma.deposit.count({ where: { status: { in: ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING"] } } }),
    prisma.game.count({ where: { status: { notIn: ["FINISHED", "CANCELLED"] } } }),
    prisma.game.count({ where: { status: { in: ["LIVE", "HALF_TIME"] } } }),
    prisma.transaction.aggregate({ where: { type: { in: ["BET_STAKE"] } }, _sum: { amount: true } }),
  ]);

  const sum = (a: { _sum: { amount: unknown } | null }) => Number(a._sum?.amount ?? 0);

  return ok({
    stats: {
      totalUsers, activeUsers, newRegistrations,
      totalDeposits: sum(totalDeposits),
      totalWithdrawals: sum(totalWithdrawals),
      totalStakes: sum(totalStakes),
      openBets, winningBets, losingBets,
      pendingWithdrawals, pendingDeposits,
      activeGames, liveGames,
      revenue: -sum(revenue), // gross margin proxy (stakes - payouts)
    },
  });
});
