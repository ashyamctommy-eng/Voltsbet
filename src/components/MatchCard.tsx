import Link from "next/link";
import OddsButton from "@/components/OddsButton";
import TeamLogo from "@/components/TeamLogo";
import { IconClock } from "@/components/icons";
import { formatKickoff, liveContext } from "@/lib/kickoff";

type MarketLite = {
  id: string;
  name: string;
  key: string;
  status: string;
  outcomes: { id: string; name: string; label: string | null; odds: unknown; status: string }[];
};

type GameLite = {
  id: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  startAt: Date;
  status: string;
  homeScore: number;
  awayScore: number;
  period: string | null;
  clock: string | null;
  live: boolean;
  featured: boolean;
  sport: { name: string; slug: string; icon: string | null };
  competitionName: string | null;
  markets: MarketLite[];
};

/** Statuses that count as in-play — everything else is pre-match/finished. */
const LIVE_STATUSES = ["LIVE", "HALF_TIME", "IN_PLAY"];

export default function MatchCard({
  game,
  showCompetition = true,
  preferMarkets,
}: {
  game: GameLite;
  showCompetition?: boolean;
  /** Restrict which market keys the card may use as its main market (e.g. "1x2" filter). */
  preferMarkets?: string[];
}) {
  void showCompetition; // reserved — league line always renders from competitionName
  const isLive = LIVE_STATUSES.includes(game.status) || game.live;
  const isFinished = game.status === "FINISHED";

  const candidates = game.markets.filter((m) => m.status === "OPEN" && m.outcomes.some((o) => o.status === "ACTIVE"));
  const openMarketCount = game.markets.filter((m) => m.status === "OPEN").length;
  const mainMarket =
    (preferMarkets ? candidates.find((m) => preferMarkets.includes(m.key)) : undefined) ??
    candidates.find((m) => m.key === "h2h" || m.key === "MATCH_RESULT") ??
    candidates[0];
  const odds = mainMarket?.outcomes.filter((o) => o.status === "ACTIVE").slice(0, 3) ?? [];
  const ctx = liveContext(game.status, game.clock, game.period);

  const logoFor = (name: string) => {
    if (name === game.homeName) return game.homeLogo;
    if (name === game.awayName) return game.awayLogo;
    return null;
  };

  return (
    <div className="card card-hover p-4">
      {/* Card header: league/competition left · green markets count right */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="line-clamp-2 font-semibold leading-tight text-ink3">
          {game.competitionName ?? game.sport.name}
        </span>
        <Link
          href={`/fixture/${game.id}`}
          className="shrink-0 font-bold text-brand hover:underline"
        >
          +{openMarketCount} Markets ›
        </Link>
      </div>

      {/* Secondary line: LIVE badge + live context, or SVG clock + kickoff.
          Pre-match (NOT_STARTED/future) never renders the red badge. */}
      <div className="mt-1.5 flex items-center gap-1.5">
        {isLive ? (
          <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-bold text-red-400">
            <span className="live-dot" /> Live
          </span>
        ) : (
          <IconClock className="h-3.5 w-3.5 shrink-0 text-ink3" />
        )}
        <span className="truncate text-xs font-medium text-ink2">
          {isLive ? (ctx ?? "In play") : formatKickoff(game.startAt)}
        </span>
      </div>

      {/* Live / finished score strip */}
      {(isLive || isFinished) && (
        <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-card2 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <TeamLogo name={game.homeName} src={game.homeLogo} className="h-5 w-5" />
            <span className="truncate">{game.homeName}</span>
          </span>
          <span className="shrink-0 text-lg font-extrabold tabular-nums">
            {game.homeScore} <span className="mx-0.5 text-ink3">–</span> {game.awayScore}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{game.awayName}</span>
            <TeamLogo name={game.awayName} src={game.awayLogo} className="h-5 w-5" />
          </span>
        </div>
      )}

      {/* Content body: stacked team/outcome rows with 1X2 odds buttons on the right */}
      {isFinished ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-card2 px-3 py-2 text-xs text-ink3">
          <span>Final score</span>
          <Link href={`/fixture/${game.id}`} className="font-semibold text-brand">Results →</Link>
        </div>
      ) : odds.length > 0 && mainMarket ? (
        <div className="mt-3 space-y-1.5">
          {odds.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg bg-card2 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <TeamLogo name={o.name} src={logoFor(o.name)} className="h-5 w-5" />
                <span className="truncate text-sm font-semibold">{o.name}</span>
                {o.label && (
                  <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-ink3">
                    {o.label}
                  </span>
                )}
              </span>
              <OddsButton
                outcomeId={o.id}
                gameId={game.id}
                sport={game.sport.name}
                competition={game.competitionName ?? game.sport.name}
                home={game.homeName}
                away={game.awayName}
                startAt={game.startAt.toISOString()}
                market={mainMarket.name}
                marketKey={mainMarket.key}
                outcome={o.name}
                label={o.label}
                odds={Number(o.odds)}
                gameStatus={game.status}
                live={isLive}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-card2 px-3 py-2 text-center text-xs font-semibold text-amber-400">
          Market Suspended
        </div>
      )}
    </div>
  );
}
