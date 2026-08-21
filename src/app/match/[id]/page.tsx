import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, fmtOdds } from "@/lib/odds";
import TeamLogo from "@/components/TeamLogo";
import FixtureMarkets from "@/components/FixtureMarkets";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      sport: true,
      competition: true,
      markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!game) notFound();

  const live = game.status === "LIVE" || game.status === "HALF_TIME";
  const openMarkets = game.markets.filter((m) => m.status === "OPEN");
  const closedMarkets = game.markets.filter((m) => m.status !== "OPEN");

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-8">
      {/* Header */}
      <div className="card mt-6 overflow-hidden">
        <div className="border-b border-line bg-gradient-to-r from-[#10182c] to-[#1a1050] px-6 py-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink3">
            <Link href="/sports" className="hover:text-ink">{game.sport.icon} {game.sport.name}</Link>
            <span>›</span>
            <span>{game.competitionName ?? game.competition?.name ?? "—"}</span>
            {!live && <span>› {formatDateTime(game.startAt)}</span>}
          </div>

          <div className="mt-4 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-10">
            <div className="flex w-40 flex-col items-center gap-2 text-center">
              <TeamLogo name={game.homeName} src={game.homeLogo} className="h-14 w-14" />
              <span className="font-bold">{game.homeName}</span>
            </div>

            <div className="text-center">
              {live ? (
                <>
                  <div className="flex items-center justify-center gap-3">
                    <span className="live-dot" />
                    <span className="text-4xl font-extrabold tabular-nums">
                      {game.homeScore} <span className="text-ink3">–</span> {game.awayScore}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-sm text-ink2">
                    {game.period ?? ""} {game.clock ? `· ${game.clock}` : ""}
                  </div>
                </>
              ) : game.status === "FINISHED" ? (
                <>
                  <span className="text-4xl font-extrabold tabular-nums">
                    {game.homeScore} <span className="text-ink3">–</span> {game.awayScore}
                  </span>
                  <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink3">Final</div>
                </>
              ) : (
                <>
                  <span className="text-2xl font-bold text-ink3">vs</span>
                  <div className="mt-1 text-xs text-ink3">
                    {game.status === "POSTPONED" ? "Postponed" : formatDateTime(game.startAt)}
                  </div>
                </>
              )}
            </div>

            <div className="flex w-40 flex-col items-center gap-2 text-center">
              <TeamLogo name={game.awayName} src={game.awayLogo} className="h-14 w-14" />
              <span className="font-bold">{game.awayName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Markets */}
      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-bold">Markets</h2>

        {openMarkets.length === 0 && (
          <div className="card p-8 text-center text-sm text-amber-400">Markets for this match are currently closed or suspended.</div>
        )}

        <FixtureMarkets
          game={{
            id: game.id,
            sport: game.sport.name,
            competition: game.competitionName ?? game.competition?.name ?? game.sport.name,
            homeName: game.homeName,
            awayName: game.awayName,
            startAt: game.startAt.toISOString(),
            status: game.status,
            live,
          }}
          markets={openMarkets.map((m) => ({
            id: m.id,
            name: m.name,
            key: m.key,
            status: m.status,
            outcomes: m.outcomes.map((o) => ({
              id: o.id,
              name: o.name,
              label: o.label,
              odds: o.odds,
              status: o.status,
            })),
          }))}
        />

        {closedMarkets.length > 0 && (
          <>
            <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-ink3">Closed / Settled</h3>
            {closedMarkets.map((market) => (
              <div key={market.id} className="card overflow-hidden opacity-70">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h3 className="font-bold">{market.name}</h3>
                  <span className="text-xs font-semibold uppercase text-ink3">{market.status}</span>
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {market.outcomes.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg bg-card2 px-3 py-2 text-sm">
                      <span>
                        {o.label && <span className="mr-1.5 font-semibold text-ink3">{o.label}</span>}
                        {o.name}
                      </span>
                      <span className="text-xs text-ink3">
                        {o.settled
                          ? o.result === "WON" ? <span className="font-bold text-green-400">Won</span>
                            : o.result === "VOID" ? <span className="font-semibold text-gray-400">Void</span>
                            : <span className="text-red-400">Lost</span>
                          : fmtOdds(o.odds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
