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
  // "Today" = the FULL local calendar day [00:00, next 00:00). The old
  // `lte: new Date()` cutoff silently dropped tonight's still-upcoming
  // kickoffs, so the header claimed "N upcoming" while the feed's Today
  // window rendered nothing.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1);
  const hideSeeded = s.hideSeededGames ? { source: "API" } : {};

  const [sports, todayGames, upcoming] = await Promise.all([
    prisma.sport.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    // Today's surface: in-play statuses OR any fixture kicking off within
    // the local calendar day (morning to late-evening — never stripped by
    // strict UTC equality).
    prisma.game.findMany({
      where: {
        sportId: sport.id,
        OR: [
          { status: { in: ["LIVE", "HALF_TIME", "IN_PLAY"] } },
          { startAt: { gte: todayStart, lt: todayEnd } },
        ],
        ...hideSeeded,
      },
      include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ status: "asc" }, { startAt: "asc" }],
    }),
    // Upcoming fixtures — the fallback pool when Today is empty.
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

  // Merge + dedupe (today's surface first, future fixtures after). The feed
  // owns the day/league filters and the header counts, so it receives the
  // full window — its auto-fallback advances the date pill when Today has
  // no pre-match games, and the header label is derived from the exact
  // array it renders.
  const byId = new Map<string, MatchFeedGame>();
  for (const g of [...todayGames, ...upcoming]) byId.set(g.id, g as MatchFeedGame);
  const games = [...byId.values()];

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
          <MatchFeed
            games={games}
            sportKey={slug}
            sports={sports}
            sportHeader={{ name: sport.name, icon: sport.icon, slug: sport.slug }}
          />
        </div>
      </div>
    </div>
  );
}
