import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/odds";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const finished = await prisma.game.findMany({
    where: { status: "FINISHED" },
    include: { sport: true },
    orderBy: { startAt: "desc" },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-8">
      <h1 className="mt-8 text-2xl font-extrabold">Results</h1>
      <p className="mt-1 text-sm text-ink2">Final scores from finished matches.</p>

      {finished.length === 0 ? (
        <div className="card mt-6 p-10 text-center text-ink3">No results yet.</div>
      ) : (
        <div className="mt-6 space-y-3">
          {finished.map((g) => (
            <Link key={g.id} href={`/match/${g.id}`} className="card card-hover flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2 text-xs text-ink3">
                <span>{g.sport.icon}</span>
                <span>{g.competitionName}</span>
                <span>{formatDateTime(g.startAt)}</span>
              </div>
              <div className="flex flex-1 items-center justify-center gap-4 text-sm font-semibold">
                <span>{g.homeName}</span>
                <span className="rounded-lg bg-card2 px-3 py-1 text-base font-extrabold tabular-nums">
                  {g.homeScore} – {g.awayScore}
                </span>
                <span>{g.awayName}</span>
              </div>
              <span className="text-xs font-semibold text-brand">Details →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
