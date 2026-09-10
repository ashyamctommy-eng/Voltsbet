import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { refreshLiveScores } from "@/lib/live-scores";
import LiveFeed from "@/components/LiveFeed";
import { LIVE_STATUSES } from "@/lib/game-status";
import { BETTABLE_MARKET_PREDICATE, LIVE_FEED_INCLUDE, LIVE_FEED_TAKE, liveFeedWhere } from "@/lib/live-feed";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const s = await getSettings();
  // Pull fresh scores/status from The Odds API /scores (throttled:
  // at most one sweep per active league per LIVE_SCORES_THROTTLE_SECONDS
  // window) before reading the DB.
  await refreshLiveScores();
  // Badge, header count and cards ALL use liveFeedWhere() (status-driven,
  // API rows only, bettable market required, API-touched within 30 min) — the
  // previous mismatch came from the page also counting stale `live: true` rows.
  const where = liveFeedWhere();
  const [liveCount, liveGames, soon] = await Promise.all([
    prisma.game.count({ where }),
    prisma.game.findMany({
      where,
      include: LIVE_FEED_INCLUDE,
      orderBy: [{ startAt: "asc" }],
      take: LIVE_FEED_TAKE,
    }),
    // Dead-hour fallback: next kickoffs so /live is never a dead end. Also
    // must be bettable — a card with no markets renders as "Market Suspended
    // (+0 Markets)", which is exactly what we are removing from this page.
    prisma.game.findMany({
      where: {
        status: { notIn: ["FINISHED", "CANCELLED", ...LIVE_STATUSES] },
        startAt: { gte: new Date() },
        source: "API",
        externalId: { not: null },
        markets: { some: BETTABLE_MARKET_PREDICATE },
      },
      include: LIVE_FEED_INCLUDE,
      orderBy: { startAt: "asc" },
      take: 6,
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-full overflow-x-hidden px-3 pb-32 sm:px-4 md:pb-10">
      <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="live-dot h-3 w-3 shrink-0" />
        <h1 className="text-xl font-extrabold sm:text-2xl">Live Betting</h1>
        <span className="shrink-0 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-bold text-red-400">{liveCount} live</span>
      </div>

      <div className="mt-6">
        <LiveFeed games={liveGames} fallback={soon} refreshSeconds={s.liveRefreshSeconds} />
      </div>
    </div>
  );
}
