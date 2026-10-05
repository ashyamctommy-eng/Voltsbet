"use client";

import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { displayOutcomeName } from "@/lib/market-labels";
import { formatDateTime, fmtOdds } from "@/lib/odds";
import type { DetailSelection } from "@/components/account/BetActions";

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "HALF_TIME", "1H", "2H", "EXTRA_TIME"]);
const FINISHED_STATUSES = new Set(["FINISHED", "ENDED", "SETTLED", "FULL_TIME", "FT", "COMPLETED"]);

const JERSEY_COLORS = ["#19a974", "#4088d8", "#d17638", "#8a70d6", "#d65e68", "#268f9d"];
function teamColor(team: string, away: boolean): string {
  if (!team.trim()) return away ? "#91a7a0" : "#24a77b";
  let hash = 0;
  for (const char of team) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return JERSEY_COLORS[(hash + (away ? 3 : 0)) % JERSEY_COLORS.length];
}

function TeamJersey({ team, away = false }: { team: string; away?: boolean }) {
  const color = teamColor(team, away);
  const label = team || (away ? "Away team" : "Home team");
  return (
    <svg
      role="img"
      aria-label={`${label} jersey`}
      viewBox="0 0 32 32"
      className="h-7 w-7 shrink-0"
    >
      <path
        d="m10 4 6 2 6-2 7 5-4 6-3-2v15H10V13l-3 2-4-6 7-5Z"
        fill={color}
        stroke="rgba(226,239,232,.5)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M13 6.2c.5 2 1.4 3.1 3 3.1s2.5-1.1 3-3.1" fill="none" stroke="rgba(15,30,24,.5)" strokeWidth="1.2" />
    </svg>
  );
}

function kickoffLabel(startAt: string): string {
  const date = new Date(startAt);
  if (!Number.isFinite(date.getTime())) return "Kickoff time unavailable";
  try {
    return formatDateTime(date);
  } catch {
    return date.toLocaleString();
  }
}

function LegIndicator({ result }: { result: string | null }) {
  if (result === "WON") return <CheckCircle2 aria-label="Won" className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (result === "LOST") return <XCircle aria-label="Lost" className="h-4 w-4 shrink-0 text-rose-500" />;
  return <Circle aria-label="Open" className="h-4 w-4 shrink-0 text-slate-500" />;
}

export default function BetLegRow({
  selection,
  showPick = true,
}: {
  selection: DetailSelection;
  showPick?: boolean;
}) {
  const gameStatus = (selection.status ?? "").toUpperCase();
  const isLive = Boolean(selection.live) || LIVE_STATUSES.has(gameStatus);
  const hasScore =
    (isLive || FINISHED_STATUSES.has(gameStatus)) &&
    Number.isFinite(selection.homeScore) &&
    Number.isFinite(selection.awayScore);
  const home = selection.home || "Home";
  const away = selection.away || "Away";
  const outcome = selection.outcome || selection.label || "Selection";

  return (
    <article className="rounded-xl border border-slate-800/90 bg-[#121a1f] p-3">
      <div className="flex items-start gap-2.5">
        <LegIndicator result={selection.result} />
        <div className="min-w-0 flex-1">
          {(selection.competition || selection.sport || isLive || hasScore) && (
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[.1em] text-slate-500">
              <span className="truncate">{selection.competition || selection.sport}</span>
              {isLive ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-rose-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  Live{selection.clock ? ` · ${selection.clock}` : selection.period ? ` · ${selection.period}` : ""}
                </span>
              ) : hasScore ? (
                <span className="shrink-0">Final</span>
              ) : null}
            </div>
          )}
          {showPick && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-extrabold leading-snug text-slate-100">
                  {displayOutcomeName(outcome, selection.marketKey || "", home, away)}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                  {selection.market || "Market"}
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm font-extrabold tabular-nums text-slate-100">
                {Number.isFinite(selection.odds) && selection.odds > 0 ? fmtOdds(selection.odds) : "—"}
              </span>
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-slate-800/80 pt-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <TeamJersey team={home} />
                <span className="truncate text-xs font-semibold text-slate-200">{home}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <TeamJersey team={away} away />
                <span className="truncate text-xs font-semibold text-slate-300">{away}</span>
              </div>
            </div>

            {hasScore ? (
              <div
                aria-label={`Score ${selection.homeScore} to ${selection.awayScore}`}
                className="flex shrink-0 items-center gap-1.5 font-mono text-xs font-extrabold tabular-nums"
              >
                <span className="rounded bg-slate-800/90 px-2.5 py-1 text-slate-100">{selection.homeScore}</span>
                <span className="text-slate-500">:</span>
                <span className="rounded bg-slate-800/90 px-2.5 py-1 text-slate-100">{selection.awayScore}</span>
              </div>
            ) : (
              <div className="max-w-[45%] shrink-0 text-right text-[10px] font-medium leading-4 text-slate-400">
                {isLive ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                    Live{selection.clock ? ` · ${selection.clock}` : selection.period ? ` · ${selection.period}` : ""}
                  </span>
                ) : (
                  kickoffLabel(selection.startAt)
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
