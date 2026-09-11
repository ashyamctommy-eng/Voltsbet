"use client";

import { useBetSlip, SlipItem } from "@/components/BetSlipContext";
import { useSiteSettings } from "@/components/SiteSettingsContext";
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
  /**
   * Text rendered on the LEFT of the pill. Falls back to `label`, then to the
   * raw outcome name — callers pass the display name ("Over 2.5", "1X", "X/2").
   */
  displayLabel?: string;
  odds: number;
  gameStatus: string;
  live?: boolean;
  /**
   * Force the unavailable state — e.g. an outcome that is not ACTIVE even
   * though it still carries a price.
   */
  disabled?: boolean;
  /**
   * Render the box with the price ONLY, no label. Used by the home/live feed
   * cards, where the outcome label is a column header above the box ("1 X 2")
   * rather than text inside it. The label is still announced to screen readers
   * via aria-label so the control never becomes a nameless number.
   */
  oddsOnly?: boolean;
};

/**
 * The platform's ONE bookable outcome widget: a horizontal pill with the
 * outcome label on the left and the odds multiplier on the right. All visual
 * styling lives in the `.odds-btn` component class (globals.css) so the home
 * feed, live lists and match detail board are identical by construction —
 * and so the dark/light theme swap is defined in exactly one place.
 */
export default function OddsButton(props: Props) {
  const { items, add, remove, setOpen } = useBetSlip();
  const { betSlipAutoOpen } = useSiteSettings();
  const selected = items.some((i) => i.outcomeId === props.outcomeId);
  // Price missing (0 / unset), explicitly disabled, or game closed → render an
  // unavailable pill that is NOT clickable. A SELECTED pick is never disabled:
  // tapping it again removes it from the slip and clears the highlight.
  const noPrice = !(props.odds > 0);
  const unavailable = noPrice || props.disabled === true;
  const suspended =
    props.gameStatus !== "SCHEDULED" && props.gameStatus !== "LIVE" && props.gameStatus !== "HALF_TIME";
  const disabled = suspended || unavailable;

  const leftText = props.displayLabel?.trim() || props.label?.trim() || props.outcome;

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
        if (selected) {
          // Toggle OFF — remove from the slip, highlight resets via `selected`.
          remove(props.outcomeId);
          return;
        }
        add(item);
        // SILENT BY DEFAULT (Admin → Website Settings → Betting →
        // "Auto-open bet slip on first pick"): the cell highlights and the
        // floating counter updates — nothing is yanked open. When the setting
        // is on, desktop pops the rail (mobile still uses the mini-bar).
        if (betSlipAutoOpen && window.innerWidth >= 1280) setOpen(true);
      }}
      className={`odds-btn active:scale-[0.99] ${selected ? "selected" : ""} ${noPrice ? "odds-btn-muted" : ""}`}
      aria-pressed={selected}
      aria-label={props.oddsOnly ? `${leftText} @ ${noPrice ? "unavailable" : fmtOdds(props.odds)}` : undefined}
      title={disabled ? (noPrice ? "Price unavailable" : "Betting closed for this game") : `Add ${leftText} @ ${fmtOdds(props.odds)}`}
    >
      {!props.oddsOnly && <span className="odds-label">{leftText}</span>}
      <span className="odds-price">{noPrice ? "-" : fmtOdds(props.odds)}</span>
    </button>
  );
}
