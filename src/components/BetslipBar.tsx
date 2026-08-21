"use client";

import { useBetSlip } from "@/components/BetSlipContext";
import { useCurrency } from "@/components/CurrencyProvider";

/**
 * Betika-style sticky yellow bottom betslip bar — appears above the bottom
 * nav whenever selections exist. Tapping it slides up the full betslip sheet.
 *
 *   [ Odds 3.05 ]   (2)   [ Payout KES 3.05 ]
 *        left        center        right
 */
export default function BetslipBar() {
  const { items, stake, totalOdds, setOpen } = useBetSlip();
  const { fmt } = useCurrency();
  const count = items.length;
  if (count === 0) return null;

  // Projection baseline until the user sets a stake (matches the sheet).
  const previewStake = parseFloat(stake) || 100;
  const payout = previewStake * totalOdds;

  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed inset-x-0 bottom-[62px] z-40 block w-full border-t border-black/10 bg-[#FFD700] text-black shadow-[0_-6px_18px_rgba(0,0,0,0.35)] xl:hidden"
      aria-label={`Open bet slip, ${count} selection${count === 1 ? "" : "s"}`}
    >
      <span className="flex w-full items-center justify-between gap-2 px-4 py-3">
        {/* Left — combined odds */}
        <span className="flex min-w-0 flex-col items-start">
          <span className="text-[10px] font-bold uppercase tracking-wider text-black/60">Odds</span>
          <span className="text-base font-black leading-tight tabular-nums">
            {totalOdds ? totalOdds.toFixed(2) : "—"}
          </span>
        </span>

        {/* Center — circular selection count badge */}
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-black/80 bg-[#FFD700] text-sm font-black tabular-nums shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
          aria-hidden
        >
          {count}
        </span>

        {/* Right — potential return */}
        <span className="flex min-w-0 flex-col items-end">
          <span className="text-[10px] font-bold uppercase tracking-wider text-black/60">Payout</span>
          <span className="truncate text-base font-black leading-tight tabular-nums">
            {fmt(Math.round(payout * 100) / 100)}
          </span>
        </span>
      </span>
    </button>
  );
}
