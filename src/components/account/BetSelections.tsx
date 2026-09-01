"use client";

import { useState } from "react";
import { formatDateTime, fmtOdds } from "@/lib/odds";
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
};

const RESULT_STYLE: Record<string, string> = {
  WON: "bg-green-500/15 text-green-400",
  LOST: "bg-red-500/15 text-red-400",
  VOID: "bg-hover-tint text-ink3",
};

/** Single selection card — collapsible: Home vs Away header + bet details. */
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
        const type = TYPE_LABEL[s.marketKey] ?? s.market;
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
                  <span className="text-ink3">Type</span>
                  <span className="font-semibold">{type}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">Starts at</span>
                  <span className="font-semibold tabular-nums">{formatDateTime(new Date(s.startAt))}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">Pick</span>
                  <span className="text-right font-semibold">
                    {s.outcome} <span className="text-brand">({fmtOdds(s.odds)})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">Outcome</span>
                  {s.result ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${RESULT_STYLE[s.result] ?? "bg-hover-tint text-ink3"}`}>
                      {s.result}
                    </span>
                  ) : (
                    <span className="rounded-full bg-hover-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink3">
                      Pending
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
