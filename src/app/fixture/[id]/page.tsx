import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { IconClock } from "@/components/icons";
import BackButton from "@/components/BackButton";
import TeamLogo from "@/components/TeamLogo";
import FixtureMarkets from "@/components/FixtureMarkets";
import KickoffFull from "@/components/KickoffFull";
import { liveContext } from "@/lib/kickoff";

export const dynamic = "force-dynamic";

/** Full fixture detail — /fixture/:id (SafiBets-style layout). */
export default async function FixturePage({ params }: { params: Promise<{ id: string }> }) {
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

  const isLive = game.status === "LIVE" || game.status === "HALF_TIME" || game.live;
  const ctx = liveContext(game.status, game.clock, game.period);
  const openMarkets = game.markets.filter((m) => m.status === "OPEN");

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-8">
      {/* Header: back arrow + league left · markets pill right */}
      <div className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <BackButton />
            <span className="truncate text-sm font-bold text-ink2">
              {game.competitionName ?? game.competition?.name ?? game.sport.name}
            </span>
          </div>
          <span className="shrink-0 rounded-full bg-brand/15 px-3 py-1 text-xs font-black text-brand">
            {openMarkets.length} Markets
          </span>
        </div>

        {/* Teams vs Teams */}
        <div className="px-5 py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamLogo name={game.homeName} src={game.homeLogo} className="h-16 w-16" />
              <span className="line-clamp-2 w-full text-sm font-bold sm:text-base">{game.homeName}</span>
            </div>

            <div className="shrink-0 px-2 text-center">
              {isLive || game.status === "FINISHED" ? (
                <span className="text-3xl font-extrabold tabular-nums">
                  {game.homeScore} <span className="text-ink3">–</span> {game.awayScore}
                </span>
              ) : (
                <span className="text-xl font-black tracking-widest text-ink3">VS</span>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamLogo name={game.awayName} src={game.awayLogo} className="h-16 w-16" />
              <span className="line-clamp-2 w-full text-sm font-bold sm:text-base">{game.awayName}</span>
            </div>
          </div>

          {/* Centered kickoff / live context */}
          <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-ink2">
            {isLive ? (
              <>
                <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-0.5 font-bold text-red-400">
                  <span className="live-dot" /> Live
                </span>
                {ctx && <span className="font-semibold">{ctx}</span>}
              </>
            ) : (
              <>
                <IconClock className="h-4 w-4 text-ink3" />
                <span className="font-medium">
                  <KickoffFull iso={game.startAt.toISOString()} />
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Markets with category navigation */}
      <div className="mt-6">
        <FixtureMarkets
          game={{
            id: game.id,
            homeName: game.homeName,
            awayName: game.awayName,
            sport: game.sport.name,
            competition: game.competitionName ?? game.competition?.name ?? game.sport.name,
            startAt: game.startAt.toISOString(),
            status: game.status,
            live: isLive,
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
      </div>
    </div>
  );
}
