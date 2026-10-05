"use client";

import { useState } from "react";
import { fmtOdds } from "@/lib/odds";
import { teamContext } from "@/lib/market-labels";
import { IconChevronDown } from "@/components/icons";
import type { DetailSelection } from "@/components/account/BetActions";
import BetLegRow from "@/components/account/BetLegRow";
import { CheckCircle2, Circle, XCircle } from "lucide-react";

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

/** Single ticket leg — the selection stays visible when collapsed. */
export default function BetSelections({ selections }: { selections: DetailSelection[] }) {
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
        const market = s.market || TYPE_LABEL[s.marketKey] || "Market";
        const selection = teamContext(s.outcome || s.label || "Selection", s.marketKey, s.home, s.away);
        return (
          <article key={s.id} className="overflow-hidden rounded-2xl border border-slate-800/80 bg-[#1a232a] p-2.5">
            <button
              onClick={() => toggle(s.id)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-800/50"
            >
              {s.result === "WON" ? (
                <CheckCircle2 aria-label="Won" className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : s.result === "LOST" ? (
                <XCircle aria-label="Lost" className="h-4 w-4 shrink-0 text-rose-500" />
              ) : (
                <Circle aria-label="Open" className="h-4 w-4 shrink-0 text-slate-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-extrabold text-slate-100">{selection}</div>
                <div className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{market}</div>
              </div>
              <span className="shrink-0 font-mono text-sm font-extrabold tabular-nums text-slate-100">
                {Number.isFinite(s.odds) && s.odds > 0 ? fmtOdds(s.odds) : "—"}
              </span>
              <IconChevronDown
                className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            {expanded && <div className="mt-1 border-t border-slate-800/80 pt-2"><BetLegRow selection={s} showPick={false} /></div>}
          </article>
        );
      })}
    </div>
  );
}
