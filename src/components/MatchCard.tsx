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
  const isLive = game.status === "LIVE" || game.status === "HALF_TIME" || game.live;
  const candidates = game.markets.filter((m) => m.status === "OPEN" && m.outcomes.some((o) => o.status === "ACTIVE"));
  const openMarketCount = game.markets.filter((m) => m.status === "OPEN").length;
  const mainMarket =
    (preferMarkets ? candidates.find((m) => preferMarkets.includes(m.key)) : undefined) ??
    candidates.find((m) => m.key === "h2h" || m.key === "MATCH_RESULT") ??
    candidates[0];
  const odds = mainMarket?.outcomes.filter((o) => o.status === "ACTIVE").slice(0, 3) ?? [];
  const ctx = liveContext(game.status, game.clock, game.period);

  return (
    <div className="card card-hover p-4">
      {/* Header row: league left · markets count right */}
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

      {/* Secondary row: LIVE badge + context, or clock + kickoff */}
      <div className="mt-1.5 flex items-center gap-1.5">
        {isLive ? (
          <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-bold text-red-400">
            <span className="live-dot" /> Live
          </span>
        ) : (
          <IconClock className="h-3.5 w-3.5 text-ink3" />
        )}
        <span className="truncate text-xs font-medium text-ink2">
          {isLive ? (ctx ?? "") : formatKickoff(game.startAt)}
        </span>
      </div>

      {/* Teams */}
      <Link href={`/fixture/${game.id}`} className="mt-3 block">
        <div className="flex items-center justify-between gap-2">
          <TeamName name={game.homeName} logo={game.homeLogo} />
          {isLive || game.status === "FINISHED" ? (
            <span className="shrink-0 text-xl font-extrabold tabular-nums">
              {game.homeScore} <span className="mx-1 text-ink3">–</span> {game.awayScore}
            </span>
          ) : (
            <span className="shrink-0 text-lg font-bold text-ink3">vs</span>
          )}
          <TeamName name={game.awayName} logo={game.awayLogo} align="right" />
        </div>
      </Link>

      {/* 1X2 odds */}
      {game.status === "FINISHED" ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-card2 px-3 py-2 text-xs text-ink3">
          <span>Final score</span>
          <Link href={`/fixture/${game.id}`} className="font-semibold text-brand">Results →</Link>
        </div>
      ) : odds.length > 0 && mainMarket ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {odds.map((o) => (
            <OddsButton
              key={o.id}
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

function TeamName({ name, logo, align = "left" }: { name: string; logo?: string | null; align?: "left" | "right" }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
      <TeamLogo name={name} src={logo} className="h-7 w-7" />
      <span className={`truncate text-sm font-semibold ${align === "right" ? "text-right" : ""}`}>{name}</span>
    </span>
  );
}
