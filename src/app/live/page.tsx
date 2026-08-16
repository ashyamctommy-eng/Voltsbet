import { prisma } from "@/lib/prisma";
import MatchCard from "@/components/MatchCard";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const liveGames = await prisma.game.findMany({
    where: { status: { in: ["LIVE", "HALF_TIME"] } },
    include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { startAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-6 flex items-center gap-2">
        <span className="live-dot h-3 w-3" />
        <h1 className="text-2xl font-extrabold">Live Betting</h1>
        <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-bold text-red-400">{liveGames.length} live</span>
      </div>

      {liveGames.length === 0 ? (
        <div className="card mt-8 p-12 text-center">
          <div className="text-4xl">📺</div>
          <p className="mt-3 font-semibold">No live events right now</p>
          <p className="mt-1 text-sm text-ink3">Check back soon — live events appear here with real-time scores.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {liveGames.map((g) => (
            <MatchCard key={g.id} game={g} />
          ))}
        </div>
      )}
    </div>
  );
}
