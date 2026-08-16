import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime, statusColor } from "@/lib/odds";

export const dynamic = "force-dynamic";

export default async function MyBetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const bets = await prisma.bet.findMany({
    where: { userId: user.id },
    include: { selections: { include: { game: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Bet History</h2>
      {bets.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink3">
          You haven&apos;t placed any bets yet.{" "}
          <Link href="/sports" className="text-brand hover:underline">Browse sports →</Link>
        </div>
      ) : (
        bets.map((bet) => (
          <div key={bet.id} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="font-bold">{bet.code}</span>
                <span className="rounded-full bg-card2 px-2.5 py-0.5 text-[11px] font-bold uppercase text-ink2">
                  {bet.type === "MULTIPLE" ? `${bet.selections.length}-fold acca` : "Single"}
                </span>
                <span className={`text-xs font-bold ${statusColor(bet.status)}`}>{bet.status}</span>
              </div>
              <span className="text-xs text-ink3">{formatDateTime(bet.createdAt)}</span>
            </div>

            <div className="mt-3 space-y-2">
              {bet.selections.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      <Link href={`/match/${s.gameId}`} className="hover:text-brand">{s.game.homeName} vs {s.game.awayName}</Link>
                    </div>
                    <div className="text-xs text-ink3">{s.marketName} · {s.outcomeName}{s.label ? ` (${s.label})` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.settled && s.result && (
                      <span className={`text-xs font-bold ${s.result === "WON" ? "text-green-400" : s.result === "VOID" ? "text-gray-400" : "text-red-400"}`}>
                        {s.result}
                      </span>
                    )}
                    <span className="font-bold text-green-400">{Number(s.oddsAtPlacement).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-ink2">Stake: <b className="text-ink">{Number(bet.stake).toLocaleString()}</b></span>
              <span className="text-ink2">Total odds: <b className="text-ink">{Number(bet.totalOdds).toFixed(2)}</b></span>
              <span className="text-ink2">
                {bet.status === "WON"
                  ? <>Return: <b className="text-green-400">{Number(bet.potentialWin).toLocaleString()}</b></>
                  : bet.status === "VOID"
                    ? <>Refunded: <b className="text-ink">{Number(bet.stake).toLocaleString()}</b></>
                    : <>Potential: <b className="text-green-400">{Number(bet.potentialWin).toLocaleString()}</b></>}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
