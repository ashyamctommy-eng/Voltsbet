"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import OddsButton from "@/components/OddsButton";
import TeamLogo from "@/components/TeamLogo";
import { liveContext } from "@/lib/kickoff";
import { toMatchView } from "@/lib/match-view";
import { outcomeSide, sideTextClass } from "@/lib/outcome-tone";
import { flagForLeague, countryForLeague } from "@/lib/league-flags";

type MarketLite = {
  id: string;
  name: string;
  key: string;
  status: string;
  outcomes: { id: string; name: string; label: string | null; odds: unknown; status: string }[];
};

type GameLite = {
  id: string;
  /** True when rendered from the API feed (no DB fixture page). */
  isApiMatch?: boolean;
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

function clockToSeconds(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const mm = clock.match(/^(\d{1,2}):(\d{2})'?$/); // "87:42" | "87:42'"
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const m = clock.match(/^(\d{1,2})'?$/); // "87" | "87'"
  if (m) return Number(m[1]) * 60;
  return null;
}

/** Compact label for an outcome without a label: "Over 2.5" → "Over", team
 *  names stay truncated by the cell. */
function shortOutcomeLabel(name: string): string {
  const short = name.replace(/\s+[\d.]+$/, "").trim(); // strip trailing line
  return short.length > 0 && short.length <= 10 ? short : name;
}

/** Live elapsed-time counter — ticks "87:56'" forward every second. */
function LiveElapsed({ clock }: { clock: string | null | undefined }) {
  const base = clockToSeconds(clock);
  const [secs, setSecs] = useState(() => base ?? 0);
  useEffect(() => {
    if (base == null) return;
    const t0 = setTimeout(() => setSecs(base), 0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [base]);
  if (base == null) return null;
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, "0");
  return <span className="tabular-nums">{m}:{s}&apos;</span>;
}

/**
 * Match card — renders from the standard MatchView contract (toMatchView).
 * Conditional rules:
 *   LIVE (timeStatus "1" / isLive)   → red • Live badge + score + elapsed
 *                                      minute; clock icon & kickoff HIDDEN.
 *   PRE-MATCH (timeStatus "0" / future) → league top-left, green markets link
 *                                      top-right, SVG clock + kickoff below,
 *                                      stacked teams + 1X2 odds right.
 */
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
  void showCompetition; // reserved — league line always renders from the view
  const { t } = useTranslation();
  const view = toMatchView(game);
  const isLive = view.isLive;
  const isFinished = game.status === "FINISHED";

  // Kickoff labels ("Today at 19:00") depend on `new Date()` + the runtime
  // locale/timezone — computing them during SSR produced different markup
  // than the client's first render (hydration mismatch). Render a stable
  // placeholder on the server, then the real label after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t0 = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t0);
  }, []);

  // Card header: country • league. The Odds API league names already carry a
  // country prefix ("England - Premier League") — strip it to avoid
  // "England • England - Premier League" duplication.
  const country = countryForLeague(view.leagueName);
  const leagueName =
    country && view.leagueName.toLowerCase().startsWith(country.toLowerCase() + " - ")
      ? view.leagueName.slice(country.length + 3)
      : view.leagueName;
  const leagueFlag = flagForLeague(view.leagueName);

  const candidates = game.markets.filter((m) => m.status === "OPEN" && m.outcomes.some((o) => o.status === "ACTIVE"));
  const openMarketCount = game.markets.filter((m) => m.status === "OPEN").length;
  const mainMarket =
    (preferMarkets ? candidates.find((m) => preferMarkets.includes(m.key)) : undefined) ??
    candidates.find((m) => m.key === "h2h" || m.key === "MATCH_RESULT") ??
    candidates[0];
  const odds = mainMarket?.outcomes.filter((o) => o.status === "ACTIVE").slice(0, 3) ?? [];
  const ctx = liveContext(game.status, game.clock, game.period);

  const isOneXTwo = mainMarket?.key === "MATCH_RESULT" || mainMarket?.key === "h2h";
  const outcomeRows: { leg: string; label: string | null; outcome?: (typeof odds)[number] }[] = isOneXTwo
    ? [
        { leg: view.homeTeam, label: "1", outcome: odds.find((o) => o.label === "1" || o.name === view.homeTeam) },
        { leg: "Draw", label: "X", outcome: odds.find((o) => (o.label ?? "").toLowerCase() === "x" || o.name.toLowerCase() === "draw") },
        { leg: view.awayTeam, label: "2", outcome: odds.find((o) => o.label === "2" || o.name === view.awayTeam) },
      ]
    : odds.map((o) => ({ leg: o.name, label: o.label, outcome: o }));

  return (
    <div className="card card-hover p-2.5 sm:p-3">
      {/* Header: country • league left · kickoff time right */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-semibold text-ink2">
          {leagueFlag && (
            <span className="mr-1">{leagueFlag}</span>
          )}
          {[country, leagueName].filter(Boolean).join(" • ")}
        </span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-ink3">
          {isLive ? (
            <span className="flex items-center gap-1.5 font-bold text-red-400">
              <span className="live-dot" />
              {view.elapsedMinute ? <LiveElapsed clock={view.elapsedMinute} /> : (ctx ?? t("match.inPlay"))}
            </span>
          ) : mounted ? (
            view.kickoffLabel
          ) : (
            " "
          )}
        </span>
      </div>

      {/* Live / finished score strip */}
      {(isLive || isFinished) && (
        <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-card2 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <TeamLogo name={view.homeTeam} src={game.homeLogo} className="h-5 w-5" />
            <span className="truncate">{view.homeTeam}</span>
          </span>
          <span className="shrink-0 text-lg font-extrabold tabular-nums">
            {view.score.replace("-", " – ")}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{view.awayTeam}</span>
            <TeamLogo name={view.awayTeam} src={game.awayLogo} className="h-5 w-5" />
          </span>
        </div>
      )}

      {/* Pre-match body: compact teams line · horizontal label-over-odds grid.
          Outcome labels sit DIRECTLY ABOVE their odds box (grid-cols-3, or
          grid-cols-2 for 2-way markets) — uniform across 1X2, Double Chance,
          Draw No Bet and Over/Under quick markets. */}
      {!isFinished && odds.length > 0 && mainMarket ? (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2 text-xs text-ink2">
            <span className="truncate font-semibold">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand/70 align-middle" />
              {view.homeTeam} <span className="text-ink3">vs</span> {view.awayTeam}
            </span>
            <span className="shrink-0 font-bold uppercase tracking-wider text-ink3">{mainMarket.name}</span>
          </div>

          <div
            className={`mt-2 grid gap-2 ${odds.length === 2 ? "grid-cols-2" : "grid-cols-3"} [&_.odds-btn]:h-9 [&_.odds-btn]:w-full [&_.odds-btn]:flex-none [&_.odds-btn]:text-xs`}
          >
            {outcomeRows.map((row, i) => {
              const tone = sideTextClass(
                outcomeSide({ label: row.label, name: row.leg, home: view.homeTeam, away: view.awayTeam })
              );
              return (
                <div key={i} className="flex flex-col gap-1">
                  <span
                    className={`truncate text-center text-[10px] font-bold uppercase tracking-wide ${
                      tone ?? "text-ink3"
                    }`}
                  >
                    {row.label ?? shortOutcomeLabel(row.leg)}
                  </span>
                  {row.outcome ? (
                    <OddsButton
                      outcomeId={row.outcome.id}
                      gameId={game.id}
                      sport={game.sport.name}
                      competition={view.leagueName}
                      home={view.homeTeam}
                      away={view.awayTeam}
                      startAt={game.startAt.toISOString()}
                      market={mainMarket.name}
                      marketKey={mainMarket.key}
                      outcome={row.outcome.name}
                      label={row.label}
                      odds={Number(row.outcome.odds)}
                      gameStatus={game.status}
                      live={isLive}
                    />
                  ) : (
                    <span
                      className="flex h-9 w-full items-center justify-center rounded-lg bg-card2 text-xs font-bold text-ink3"
                      title={t("match.priceUnavailable")}
                    >
                      -
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : !isFinished ? (
        <div className="mt-2 rounded-lg bg-card2 px-3 py-2 text-center text-xs font-semibold text-amber-400">
          {t("match.marketSuspended")}
        </div>
      ) : null}

      {/* Footer: +X Markets green callout badge, bottom right */}
      <div className="mt-2 flex items-center justify-end">
        {game.isApiMatch ? (
          <span className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-black text-brand">
            {t("common.marketsCount", { count: openMarketCount })}
          </span>
        ) : (
          <Link
            href={`/fixture/${game.id}`}
            className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-black text-brand transition-colors hover:bg-brand/20"
          >
            {t("common.marketsCount", { count: openMarketCount })}
          </Link>
        )}
      </div>
    </div>
  );
}
