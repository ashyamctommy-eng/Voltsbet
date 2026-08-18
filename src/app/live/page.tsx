import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import LiveFeed from "@/components/LiveFeed";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const s = await getSettings();
  const liveGames = await prisma.game.findMany({
    where: {
      status: { notIn: ["FINISHED", "CANCELLED"] },
      ...(s.hideSeededGames ? { source: "API" } : {}),
    },
    include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: [{ status: "asc" }, { startAt: "asc" }],
    take: 60,
  });

  const liveCount = liveGames.filter((g) => g.status === "LIVE" || g.status === "HALF_TIME").length;

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-6 flex items-center gap-2">
        <span className="live-dot h-3 w-3" />
        <h1 className="text-2xl font-extrabold">Live Betting</h1>
        <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-bold text-red-400">{liveCount} live</span>
      </div>

      <div className="mt-6">
        <LiveFeed games={liveGames} />
      </div>
    </div>
  );
}
