import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import MatchCard from "@/components/MatchCard";

export const dynamic = "force-dynamic";

export default async function SportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sport = await prisma.sport.findUnique({ where: { slug } });
  if (!sport || !sport.active) notFound();

  const s = await getSettings();
  const [sports, allGames] = await Promise.all([
    prisma.sport.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.game.findMany({
      where: {
        sportId: sport.id,
        ...(s.hideSeededGames ? { source: "API" } : {}),
      },
      include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ status: "asc" }, { startAt: "asc" }],
    }),
  ]);

  // Top leagues bubble to the top of every section
  const TOP_LEAGUES = ["Premier League", "Championship", "La Liga", "Serie A", "Bundesliga", "NBA", "MLB", "NHL"];
  const leagueRank = (g: { competitionName: string | null }) => {
    const name = g.competitionName ?? "";
    const i = TOP_LEAGUES.findIndex((l) => name.toLowerCase().includes(l.toLowerCase()));
    return i === -1 ? 99 : i;
  };

  // Live matches are isolated to /live — this page lists pre-match + settled.
  const listable = allGames.filter((g) => !(g.status === "LIVE" || g.status === "HALF_TIME" || g.status === "IN_PLAY"));

  // Group: Today → Upcoming → Finished
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // DST-safe next local midnight (a day is 23h/25h across transitions).
  const endOfToday = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + 1);
  const byLeague = (arr: typeof allGames) =>
    [...arr].sort((a, b) => leagueRank(a) - leagueRank(b) || a.startAt.getTime() - b.startAt.getTime());
  const today = byLeague(listable.filter((g) => g.status === "SCHEDULED" && g.startAt >= startOfToday && g.startAt < endOfToday));
  const upcoming = byLeague(listable.filter((g) => g.status === "SCHEDULED" && g.startAt >= endOfToday));
  const others = byLeague(listable.filter((g) => !today.includes(g) && !upcoming.includes(g)));

  const groups: [string, typeof allGames][] = [
    ["Today", today],
    ["Upcoming", upcoming],
    ["Other", others],
  ];

  /** Group a time section's games by competition (top leagues first, then alpha). */
  const groupByCompetition = (games: typeof allGames) => {
    const map = new Map<string, typeof allGames>();
    for (const g of games) {
      const key = g.competitionName ?? g.sport.name;
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map.entries()].sort(
      ([a], [b]) =>
        (TOP_LEAGUES.findIndex((l) => a.toLowerCase().includes(l.toLowerCase())) === -1 ? 99 : TOP_LEAGUES.findIndex((l) => a.toLowerCase().includes(l.toLowerCase()))) -
        (TOP_LEAGUES.findIndex((l) => b.toLowerCase().includes(l.toLowerCase())) === -1 ? 99 : TOP_LEAGUES.findIndex((l) => b.toLowerCase().includes(l.toLowerCase()))) ||
        a.localeCompare(b),
    );
  };

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
                  {groupByCompetition(games).map(([comp, compGames]) => (
                    <div key={comp} className="mb-4">
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-ink3">
                        <span className="h-1 w-1 rounded-full bg-brand" /> {comp}
                      </h3>
                      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                        {compGames.map((g) => (
                          <MatchCard key={g.id} game={g} showCompetition={false} />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ) : null
            )
          )}
        </div>
      </div>
    </div>
  );
}
