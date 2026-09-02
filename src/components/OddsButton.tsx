"use client";

import { useBetSlip, SlipItem } from "@/components/BetSlipContext";
import { fmtOdds } from "@/lib/odds";
import { outcomeSide, sideTextClass } from "@/lib/outcome-tone";

type Props = {
  outcomeId: string;
  gameId: string;
  sport: string;
  competition: string;
  home: string;
  away: string;
  startAt: string;
  market: string;
  marketKey: string;
  outcome: string;
  label?: string | null;
  odds: number;
  gameStatus: string;
  live?: boolean;
  /** True when this outcome belongs to a two-variable market (Goal Line,
   *  BTTS, DNB, Asian handicap…) — the ONLY boards that get the emerald/sky
   *  side colors. 1X2 & other 3+-way markets stay neutral. */
  twoWay?: boolean;
};

export default function OddsButton(props: Props) {
  const { items, add, remove, setOpen } = useBetSlip();
  const selected = items.some((i) => i.outcomeId === props.outcomeId);
  // Price missing (0 / unset) or game closed → render a "-" placeholder that
  // is NOT clickable. A SELECTED pick is never disabled: tapping it again
  // removes it from the slip and clears the highlight.
  const unavailable = !(props.odds > 0);
  const suspended =
    props.gameStatus !== "SCHEDULED" && props.gameStatus !== "LIVE" && props.gameStatus !== "HALF_TIME";
  const disabled = suspended || unavailable;

  // Competing-side color token — ONLY on two-variable markets (per product
  // spec): column 1 (Over/Home/Yes/Team 1) emerald, column 2 (Under/Away/
  // No/Team 2) sky. Applied to the price while selectable and NOT selected —
  // the selected state keeps its high-contrast green fill + dark text.
  const tone = props.twoWay
    ? sideTextClass(outcomeSide({ label: props.label, name: props.outcome, home: props.home, away: props.away }))
    : null;

  const item: SlipItem = {
    outcomeId: props.outcomeId,
    gameId: props.gameId,
    sport: props.sport,
    competition: props.competition,
    home: props.home,
    away: props.away,
    startAt: props.startAt,
    market: props.market,
    marketKey: props.marketKey,
    outcome: props.outcome,
    label: props.label ?? "",
    odds: props.odds,
    gameStatus: props.gameStatus,
    live: props.live,
  };

  const canTone = !disabled && !selected && tone !== null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (selected) {
          // Toggle OFF — remove from the slip, highlight resets via `selected`.
          remove(props.outcomeId);
          return;
        }
        add(item);
        // Desktop: the rail opens immediately. Mobile: the floating mini-bar
        // appears — tapping it (or the Bets tab) opens the sheet.
        if (window.innerWidth >= 1280) setOpen(true);
      }}
      className={`odds-btn active:scale-95 ${selected ? "selected" : ""} ${unavailable ? "odds-btn-muted" : ""}`}
      aria-pressed={selected}
      title={disabled ? (unavailable ? "Price unavailable" : "Betting closed for this game") : `Add ${props.outcome} @ ${fmtOdds(props.odds)}`}
    >
      {unavailable ? "-" : canTone ? <span className={tone}>{fmtOdds(props.odds)}</span> : fmtOdds(props.odds)}
    </button>
  );
}
