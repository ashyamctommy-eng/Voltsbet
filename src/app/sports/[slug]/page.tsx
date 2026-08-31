import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import MatchFeed, { type FeedGame as MatchFeedGame } from "@/components/MatchFeed";

export const dynamic = "force-dynamic";

export default async function SportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sport = await prisma.sport.findUnique({ where: { slug } });
  if (!sport || !sport.active) notFound();

  const s = await getSettings();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hideSeeded = s.hideSeededGames ? { source: "API" } : {};

  const [sports, liveToday, upcoming] = await Promise.all([
    prisma.sport.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    // Live / kicked-off-today matches first — the "now" surface.
    prisma.game.findMany({
      where: {
        sportId: sport.id,
        OR: [
          { status: { in: ["LIVE", "HALF_TIME", "IN_PLAY"] } },
          { startAt: { gte: todayStart, lte: new Date() } },
        ],
        ...hideSeeded,
      },
      include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ status: "asc" }, { startAt: "asc" }],
    }),
    // Upcoming fixtures — the fallback when nothing is live/today.
    prisma.game.findMany({
      where: {
        sportId: sport.id,
        status: { notIn: ["FINISHED", "CANCELLED", "LIVE", "HALF_TIME"] },
        startAt: { gte: new Date() },
        ...hideSeeded,
      },
      include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ live: "desc" }, { startAt: "asc" }],
    }),
  ]);

  // UX guard: a sport tab with no live/today matches falls back to upcoming
  // fixtures instead of an empty state.
  const games = liveToday.length > 0 ? liveToday : upcoming;
  const mode: "live" | "upcoming" = liveToday.length > 0 ? "live" : "upcoming";

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-6 flex flex-wrap gap-4">
        {/* Left sport nav */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-20 space-y-1">
            <Link href="/sports" className="block rounded-lg px-3 py-2 text-sm font-medium text-ink2 hover:bg-hover-tint hover:text-ink">All Sports</Link>
            <Link href="/live" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink2 hover:bg-hover-tint hover:text-ink">
              <span className="live-dot" /> Live
            </Link>
            {sports.map((sp) => (
              <Link
                key={sp.id}
                href={`/sports/${sp.slug}`}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  sp.id === sport.id ? "bg-brand/10 font-semibold text-brand" : "text-ink2 hover:bg-hover-tint hover:text-ink"
                }`}
              >
                {sp.icon} {sp.name}
              </Link>
            ))}
          </div>
        </aside>

        {/* Center: unified match feed — same filter pill row as the landing
            page (Filters | Today | Highlights | 1x2 / Winner), scoped to this
            sport via the route. Live matches stay on /live; finished on
            /results. */}
        <div className="min-w-0 flex-1 pb-8">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{sport.icon}</span>
            <div>
              <h1 className="text-2xl font-extrabold">{sport.name}</h1>
              <p className="text-sm text-ink3">
                {mode === "live"
                  ? `${games.length} live / today${liveToday.length === 0 ? "" : ""}`
                  : `${games.length} upcoming matches`}
              </p>
            </div>
          </div>

          <MatchFeed games={games as MatchFeedGame[]} sportKey={slug} sports={sports} />
        </div>
      </div>
    </div>
  );
}
