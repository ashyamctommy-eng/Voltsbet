"use client";

import { useBetSlip, SlipItem } from "@/components/BetSlipContext";
import { fmtOdds } from "@/lib/odds";

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
};

export default function OddsButton(props: Props) {
  const { items, add, setOpen } = useBetSlip();
  const selected = items.some((i) => i.outcomeId === props.outcomeId);
  const suspended = props.gameStatus !== "SCHEDULED" && props.gameStatus !== "LIVE" && props.gameStatus !== "HALF_TIME";
  const disabled = suspended;

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

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        add(item);
        // Desktop: the rail opens immediately. Mobile: the floating mini-bar
        // appears — tapping it (or the Bets tab) opens the sheet.
        if (window.innerWidth >= 1280) setOpen(true);
      }}
      className={`odds-btn active:scale-95 ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      title={disabled ? "Betting closed for this game" : `Add ${props.outcome} @ ${fmtOdds(props.odds)}`}
    >
      {fmtOdds(props.odds)}
    </button>
  );
}
