"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime, fmtOdds } from "@/lib/odds";
import { teamContext } from "@/lib/market-labels";
import { IconChevronDown } from "@/components/icons";
import type { DetailSelection } from "@/components/account/BetActions";

/** Market key → friendly bet "Type" label ("h2h" → "1x2"). */
const TYPE_LABEL: Record<string, string> = {
  h2h: "1x2",
  MATCH_RESULT: "1x2",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Over/Under",
  TOTALS: "Totals",
  BTTS: "Both Teams To Score",
  HT_RESULT: "Half-Time Result",
  HALF_TIME_RESULT: "Half-Time Result",
  DRAW_NO_BET: "Draw No Bet",
  // Extended / derived families
  ALTERNATE_TOTALS: "Goal Line",
  ALTERNATE_SPREAD: "Handicap",
  SPREAD: "Handicap",
  SPREAD_1H: "1st Half Handicap",
  SPREAD_2H: "2nd Half Handicap",
  TEAM_TOTALS_HOME: "Home Team Totals",
  TEAM_TOTALS_AWAY: "Away Team Totals",
  CORRECT_SCORE: "Correct Score",
  HT_FT: "Half-Time / Full-Time",
  GOAL_PARITY: "Odd/Even",
  CLEAN_SHEET: "Clean Sheet",
  WIN_TO_NIL: "Win to Nil",
  MULTI_GOALS: "Multi-Goals",
  HIGHEST_SCORING_HALF: "Highest Scoring Half",
  FIRST_HALF_BTTS: "1st Half BTTS",
  EUROPEAN_HANDICAP: "European Handicap",
  OVER_UNDER_1H: "1st Half Over/Under",
  OVER_UNDER_2H: "2nd Half Over/Under",
  TOTAL_CORNERS: "Total Corners",
  TOTAL_BOOKINGS: "Total Cards/Bookings",
  CORNERS_1X2: "Corners 1X2",
  CORNERS_HANDICAP: "Handicap Corners",
  CARDS_HANDICAP: "Handicap Cards",
  TEAM_CORNERS: "Team Total Corners",
  TO_QUALIFY: "To Qualify",
};

const RESULT_STYLE: Record<string, string> = {
  WON: "bg-green-500/15 text-green-400",
  LOST: "bg-red-500/15 text-red-400",
  VOID: "bg-hover-tint text-ink3",
};

/** Live-ish statuses — render a LIVE indicator instead of the kickoff date. */
const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "HALF_TIME"]);

/** Rough elapsed minute from a live match's kickoff (no clock in bet history). */
function liveElapsed(startAtIso: string): number {
  const start = new Date(startAtIso).getTime();
  if (!Number.isFinite(start)) return 0;
  const mins = Math.floor((Date.now() - start) / 60_000);
  return Math.max(0, Math.min(mins, 240));
}

/** Single selection card — collapsible: Home vs Away header + bet details. */
export default function BetSelections({ selections }: { selections: DetailSelection[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<string>>(() => new Set(selections.map((s) => s.id)));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-2.5">
      {selections.map((s) => {
        const expanded = open.has(s.id);
        const type = TYPE_LABEL[s.marketKey] ?? s.market;
        const isLive = s.live || LIVE_STATUSES.has(s.status);
        return (
          <div key={s.id} className="card overflow-hidden">
            {/* Team header */}
            <button
              onClick={() => toggle(s.id)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{s.home}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#052e16]">
                    VS
                  </span>
                  <span className="truncate text-sm font-bold text-ink2">{s.away}</span>
                </div>
              </div>
              <IconChevronDown
                className={`h-4 w-4 shrink-0 text-ink3 transition-transform ${expanded ? "" : "rotate-180"}`}
              />
            </button>

            {expanded && (
              <div className="space-y-2 border-t border-line px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">{t("bet.type")}</span>
                  <span className="font-semibold">{type}</span>
                </div>
                {isLive ? (
                  // Live leg: never show the (now historical) kickoff date —
                  // render a LIVE indicator with the elapsed minute instead.
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink3">{t("bet.status")}</span>
                    <span className="flex items-center gap-1.5 font-bold text-red-400">
                      <span className="live-dot h-2 w-2" />
                      {t("bet.liveElapsed", { minute: liveElapsed(s.startAt) })}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink3">{t("bet.startsAt")}</span>
                    <span className="font-semibold tabular-nums">{formatDateTime(new Date(s.startAt))}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">{t("bet.pick")}</span>
                  <span className="text-right font-semibold">
                    {teamContext(s.outcome, s.marketKey, s.home, s.away)} <span className="text-brand">({fmtOdds(s.odds)})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">{t("bet.outcome")}</span>
                  {s.result ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${RESULT_STYLE[s.result] ?? "bg-hover-tint text-ink3"}`}>
                      {s.result}
                    </span>
                  ) : (
                    <span className="rounded-full bg-hover-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink3">
                      {t("bet.pending")}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
