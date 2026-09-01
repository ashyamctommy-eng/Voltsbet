import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import BetsList, { type BetsListItem } from "@/components/account/BetsList";

export const dynamic = "force-dynamic";

export default async function MyBetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const bets = await prisma.bet.findMany({
    where: { userId: user.id },
    include: { selections: { select: { settled: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const items: BetsListItem[] = bets.map((b) => ({
    id: b.id,
    code: b.code,
    type: b.type,
    stake: b.stake.toString(),
    totalOdds: b.totalOdds.toString(),
    potentialWin: b.potentialWin.toString(),
    status: b.status,
    settledAt: b.settledAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    selectionCount: b.selections.length,
    settledCount: b.selections.filter((s) => s.settled).length,
  }));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">My Bets</h2>
      <BetsList bets={items} />
    </div>
  );
}
