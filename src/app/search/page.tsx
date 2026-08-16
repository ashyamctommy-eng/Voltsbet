import Link from "next/link";
import { prisma } from "@/lib/prisma";
import MatchCard from "@/components/MatchCard";
import { formatDateTime } from "@/lib/odds";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  let games: Awaited<ReturnType<typeof findGames>> = [];
  let teams: { name: string }[] = [];
  let competitions: { id: string; name: string; sport: { slug: string } }[] = [];

  if (query.length >= 2) {
    games = await findGames(query);
    teams = await prisma.team.findMany({ where: { name: { contains: query } }, take: 10 });
    competitions = await prisma.competition.findMany({
      where: { name: { contains: query } },
      include: { sport: true },
      take: 5,
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-8">
      <h1 className="mt-8 text-2xl font-extrabold">Search</h1>
      <form className="mt-4" action="/search">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search teams, matches, competitions…"
          className="input max-w-xl"
          autoFocus
        />
      </form>

      {query.length < 2 ? (
        <p className="mt-6 text-sm text-ink3">Type at least 2 characters to search.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {games.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink2">Matches · {games.length}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {games.map((g) => <MatchCard key={g.id} game={g} />)}
              </div>
            </section>
          )}

          {teams.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink2">Teams & Players</h2>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => (
                  <span key={t.name} className="rounded-full border border-line px-3 py-1.5 text-sm">{t.name}</span>
                ))}
              </div>
            </section>
          )}

          {competitions.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink2">Competitions</h2>
              <div className="flex flex-wrap gap-2">
                {competitions.map((c) => (
                  <Link key={c.id} href={`/sports/${c.sport.slug}`} className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-brand">
                    {c.name}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {games.length === 0 && teams.length === 0 && competitions.length === 0 && (
            <div className="card p-10 text-center text-ink3">No results for “{query}”</div>
          )}
        </div>
      )}
    </div>
  );
}

async function findGames(query: string) {
  return prisma.game.findMany({
    where: { OR: [{ homeName: { contains: query } }, { awayName: { contains: query } }, { competitionName: { contains: query } }] },
    include: { sport: true, markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { startAt: "asc" },
    take: 20,
  });
}
