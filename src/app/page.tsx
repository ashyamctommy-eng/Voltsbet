import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getPrematchFeed, apiMatchToFeedGame } from "@/lib/feed";
import { isLiveStatus } from "@/lib/game-status";
import BannerCarousel from "@/components/BannerCarousel";
import MatchSlideshow from "@/components/MatchSlideshow";
import MatchFeed, { type FeedGame as MatchFeedGame } from "@/components/MatchFeed";

export const dynamic = "force-dynamic";

/** The homepage renders from the DB whenever the DB holds any near-term
 *  games (0 API requests — quota stays intact). A live API bootstrap only
 *  happens on a truly cold/empty DB (fresh deploy / pre-first-cron).
 *  NOTE: an age-based "freshness" gate was removed — with the free-tier
 *  sync cadence (every 2 days) DB games are routinely >8h old, and the
 *  gate caused a quota-starved partial API feed to MASK good DB games. */
export default async function HomePage() {
  const s = await getSettings();
  const [banners, dbGames, popularSports, promotions] = await Promise.all([
    prisma.banner.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    // Synced DB games (cron sync keeps them fresh). Rendered first when recent
    // — this is the free-tier-friendly path: 0 API requests per page load.
    prisma.game.findMany({
      where: {
        status: { notIn: ["FINISHED", "CANCELLED", "LIVE", "HALF_TIME"] },
        // Near-term upcoming fixtures ONLY — a match that already kicked off
        // (startAt <= now) is no longer pre-match: it belongs on /live (the
        // /scores pipeline owns started games) or /results. Stale SCHEDULED
        // rows from older syncs must never flood the home feed.
        startAt: { gte: new Date() },
        ...(s.hideSeededGames ? { source: "API" } : {}),
      },
      include: {
        sport: true,
        markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ live: "desc" }, { startAt: "asc" }],
      take: 200,
    }),
    prisma.sport.findMany({
      where: { active: true },
      include: { _count: { select: { games: { where: { status: { notIn: ["FINISHED", "CANCELLED"] } } } } } },
      orderBy: [{ isPopular: "desc" }, { sortOrder: "asc" }],
      take: 12,
    }),
    prisma.promotion.findMany({
      where: { active: true, OR: [{ endAt: null }, { endAt: { gt: new Date() } }] },
      orderBy: { sortOrder: "asc" },
      take: 3,
    }),
  ]);

  // API bootstrap ONLY when the DB is empty (fresh deploy / pre-first-cron).
  // TTL-cached server-side (6h), so it runs at most a few times a day even
  // then. Live matches are filtered OUT of home — /live.
  const apiFeed = dbGames.length > 0 ? null : await getPrematchFeed().catch(() => null);
  const games: MatchFeedGame[] = (
    apiFeed?.matches.length
      ? apiFeed.matches.map(apiMatchToFeedGame)
      : (dbGames as MatchFeedGame[])
  )
    // Unpriced fixtures (no active bookmaker markets) are never displayed —
    // no empty cards, no suspended overlays.
    .filter((g) => !Array.isArray((g as { markets?: unknown[] }).markets) || (g as { markets: unknown[] }).markets.length > 0)
    .filter((g) => !isLiveStatus(g.status, g.live));

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      {/* Live / upcoming match slideshow */}
      <MatchSlideshow games={games} />

      {/* Match feed with time + market filters — defaults to Football */}
      {apiFeed?.matches.length ? (
        <div className="mt-4 flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[10px] font-bold text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            THE ODDS API
          </span>
          <span className="text-[11px] font-semibold text-ink3">
            {apiFeed.matches.length} matches · Today's pre-match odds — The Odds API
          </span>
        </div>
      ) : null}
      <MatchFeed games={games} sports={popularSports} />

      {/* Admin banners */}
      {banners.length > 0 && (
        <section className="mt-10">
          <BannerCarousel
            banners={banners.map((b) => ({ id: b.id, title: b.title, description: b.description, image: b.image, ctaText: b.ctaText, ctaUrl: b.ctaUrl }))}
          />
        </section>
      )}

      {/* Popular sports */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Popular Sports</h2>
          <Link href="/sports" className="text-sm font-semibold text-brand hover:underline">All sports →</Link>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 md:grid-cols-4 lg:grid-cols-6">
          {popularSports.map((sp) => (
            <Link
              key={sp.id}
              href={`/sports/${sp.slug}`}
              className="card card-hover flex w-28 shrink-0 flex-col items-center gap-1.5 px-3 py-4 text-center sm:w-auto"
            >
              <span className="text-3xl">{sp.icon}</span>
              <span className="text-sm font-semibold">{sp.name}</span>
              <span className="text-[11px] text-ink3">{sp._count.games} matches</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Promotions */}
      {promotions.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Promotions</h2>
            <Link href="/promotions" className="text-sm font-semibold text-brand hover:underline">View all →</Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {promotions.map((p) => (
              <Link key={p.id} href="/promotions" className="card card-hover relative overflow-hidden p-5">
                <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand/10" />
                <span className="rounded-full bg-brand/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
                  {p.bonusType?.replace("_", " ") ?? "Promo"}
                </span>
                <h3 className="mt-3 font-bold">{p.title}</h3>
                <p className="mt-1 text-sm text-ink2 line-clamp-2">{p.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Responsible gambling strip */}
      <section className="mt-10 rounded-2xl border border-line bg-gradient-to-r from-[#10182c] to-[#1a1050] p-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-lg font-bold">Play responsibly</h3>
            <p className="mt-1 text-sm text-ink2">Set deposit limits, self-exclude, or get help — your wellbeing comes first.</p>
          </div>
          <Link href="/responsible-gambling" className="btn btn-ghost shrink-0">Learn more</Link>
        </div>
      </section>
    </div>
  );
}
