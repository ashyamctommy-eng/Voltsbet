import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { refreshLiveScores } from "@/lib/live-scores";
import LiveFeed from "@/components/LiveFeed";
import { LIVE_STATUSES } from "@/lib/game-status";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const s = await getSettings();
  // Pull fresh scores/status from The Odds API /scores (throttled:
  // at most one sweep per active league per LIVE_SCORES_THROTTLE_SECONDS
  // window) before reading the DB.
  await refreshLiveScores();
  // The badge and the rendered cards must count the SAME set: every row the
  // feed's isLiveStatus() filter accepts (status in LIVE_STATUSES OR live:true).
  const liveGames = await prisma.game.findMany({
    where: {
      OR: [{ status: { in: [...LIVE_STATUSES] } }, { live: true }],
      ...(s.hideSeededGames ? { source: "API" } : {}),
    },
    include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: [{ status: "asc" }, { startAt: "asc" }],
    take: 60,
  });

  // Dead-hour fallback: today's next kickoffs so /live is never an empty
  // dead end (matches the sport-feed "fall back to upcoming" philosophy).
  const soon = await prisma.game.findMany({
    where: {
      status: { notIn: ["FINISHED", "CANCELLED", ...LIVE_STATUSES] },
      startAt: { gte: new Date() },
      ...(s.hideSeededGames ? { source: "API" } : {}),
    },
    include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { startAt: "asc" },
    take: 6,
  });

  const liveCount = liveGames.length;

  return (
    <div className="mx-auto w-full max-w-full overflow-x-hidden px-4">
      <div className="mt-6 flex items-center gap-2">
        <span className="live-dot h-3 w-3" />
        <h1 className="text-2xl font-extrabold">Live Betting</h1>
        <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-bold text-red-400">{liveCount} live</span>
      </div>

      <div className="mt-6">
        <LiveFeed games={liveGames} fallback={soon} refreshSeconds={s.liveRefreshSeconds} />
      </div>
    </div>
  );
}
