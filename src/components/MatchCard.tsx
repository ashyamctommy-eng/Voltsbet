import Link from "next/link";
import OddsButton from "@/components/OddsButton";
import TeamLogo from "@/components/TeamLogo";
import { formatDateTime } from "@/lib/odds";

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
  const live = game.status === "LIVE" || game.status === "HALF_TIME";
  const candidates = game.markets.filter((m) => m.status === "OPEN" && m.outcomes.some((o) => o.status === "ACTIVE"));
  const mainMarket =
    (preferMarkets ? candidates.find((m) => preferMarkets.includes(m.key)) : undefined) ??
    candidates.find((m) => m.key === "h2h" || m.key === "MATCH_RESULT") ??
    candidates[0];
  const odds = mainMarket?.outcomes.filter((o) => o.status === "ACTIVE").slice(0, 3) ?? [];

  return (
    <div className="card card-hover p-4">
      <div className="flex items-center justify-between gap-2 text-xs">
        {showCompetition ? (
          <span className="truncate font-semibold text-ink3">{game.competitionName ?? game.sport.name}</span>
        ) : (
          <span />
        )}
        {live ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-bold text-red-400">
            <span className="live-dot" />
            LIVE {game.clock ? `· ${game.clock}` : ""}
            {game.period ? ` · ${game.period}` : ""}
          </span>
        ) : game.status === "POSTPONED" ? (
          <span className="shrink-0 rounded-full bg-gray-500/15 px-2 py-0.5 font-semibold text-gray-400">Postponed</span>
        ) : (
          <span className="shrink-0 text-ink3">{formatDateTime(game.startAt)}</span>
        )}
      </div>

      <Link href={`/match/${game.id}`} className="mt-3 block">
        <div className="flex items-center justify-between gap-2">
          <TeamName name={game.homeName} logo={game.homeLogo} />
          {live || game.status === "FINISHED" ? (
            <span className="shrink-0 text-xl font-extrabold tabular-nums">
              {game.homeScore} <span className="mx-1 text-ink3">–</span> {game.awayScore}
            </span>
          ) : (
            <span className="shrink-0 text-lg font-bold text-ink3">vs</span>
          )}
          <TeamName name={game.awayName} logo={game.awayLogo} align="right" />
        </div>
      </Link>

      {game.status === "FINISHED" ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-card2 px-3 py-2 text-xs text-ink3">
          <span>Final score</span>
          <Link href={`/match/${game.id}`} className="font-semibold text-brand">Results →</Link>
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
              live={live}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-card2 px-3 py-2 text-center text-xs font-semibold text-amber-400">
          Market Suspended
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-ink3">{mainMarket?.name ?? "No open markets"}</span>
        <Link href={`/match/${game.id}`} className="font-semibold text-brand hover:underline">
          More markets →
        </Link>
      </div>
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
