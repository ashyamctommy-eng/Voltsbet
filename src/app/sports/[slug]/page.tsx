import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MatchCard from "@/components/MatchCard";

export const dynamic = "force-dynamic";

export default async function SportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sport = await prisma.sport.findUnique({ where: { slug } });
  if (!sport || !sport.active) notFound();

  const [sports, allGames] = await Promise.all([
    prisma.sport.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.game.findMany({
      where: { sportId: sport.id },
      include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ status: "asc" }, { startAt: "asc" }],
    }),
  ]);

  // Group: Live → Today → Upcoming → Finished
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86400_000);
  const live = allGames.filter((g) => g.status === "LIVE" || g.status === "HALF_TIME");
  const today = allGames.filter((g) => g.status === "SCHEDULED" && g.startAt >= startOfToday && g.startAt < endOfToday);
  const upcoming = allGames.filter((g) => g.status === "SCHEDULED" && g.startAt >= endOfToday);
  const others = allGames.filter((g) => !live.includes(g) && !today.includes(g) && !upcoming.includes(g));

  const groups: [string, typeof allGames][] = [
    ["Live Now", live],
    ["Today", today],
    ["Upcoming", upcoming],
    ["Other", others],
  ];

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-6 flex flex-wrap gap-4">
        {/* Left sport nav */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-20 space-y-1">
            <Link href="/sports" className="block rounded-lg px-3 py-2 text-sm font-medium text-ink2 hover:bg-white/5 hover:text-ink">All Sports</Link>
            <Link href="/live" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink2 hover:bg-white/5 hover:text-ink">
              <span className="live-dot" /> Live
            </Link>
            {sports.map((sp) => (
              <Link
                key={sp.id}
                href={`/sports/${sp.slug}`}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  sp.id === sport.id ? "bg-brand/10 font-semibold text-brand" : "text-ink2 hover:bg-white/5 hover:text-ink"
                }`}
              >
                {sp.icon} {sp.name}
              </Link>
            ))}
          </div>
        </aside>

        {/* Center: matches grouped by competition */}
        <div className="min-w-0 flex-1 pb-8">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{sport.icon}</span>
            <div>
              <h1 className="text-2xl font-extrabold">{sport.name}</h1>
              <p className="text-sm text-ink3">{allGames.length} matches</p>
            </div>
          </div>

          {allGames.length === 0 ? (
            <div className="card mt-6 p-10 text-center text-ink3">No matches available for {sport.name}.</div>
          ) : (
            groups.map(([label, games]) =>
              games.length > 0 ? (
                <section key={label} className="mt-6">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink2">{label} · {games.length}</h2>
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {games.map((g) => (
                      <MatchCard key={g.id} game={g} />
                    ))}
                  </div>
                </section>
              ) : null
            )
          )}
        </div>
      </div>
    </div>
  );
}
