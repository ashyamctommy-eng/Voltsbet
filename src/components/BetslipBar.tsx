"use client";

import { useBetSlip } from "@/components/BetSlipContext";
import { IconChevronRight } from "@/components/icons";

/** Accumulator bonus tiers (matches the message shown in the betslip sheet). */
const BONUS_TIERS: Record<number, number> = { 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 10 };

/** Sticky betslip bar above the bottom nav — appears when picks exist. */
export default function BetslipBar() {
  const { items, stake, totalOdds, potentialWin, setOpen } = useBetSlip();
  const count = items.length;
  if (count === 0) return null;

  const tier = BONUS_TIERS[count];
  const nextTier = BONUS_TIERS[count + 1];
  const previewStake = parseFloat(stake) || 100; // projection baseline until a stake is set
  const payout = previewStake * totalOdds;

  const bonusMsg =
    count < 2
      ? `Add ${2 - count} more selection${2 - count > 1 ? "s" : ""} for 4% bonus`
      : tier
        ? nextTier
          ? `Accumulator bonus ${tier}% applied — add 1 more for ${nextTier}%`
          : `Accumulator bonus ${tier}% applied`
        : "Tap to view your bet slip";

  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed inset-x-0 bottom-[62px] z-40 block w-full text-left xl:hidden"
      aria-label={`Open bet slip, ${count} selections`}
    >
      {/* Green bonus strip */}
      <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-green-600 px-4 py-1.5">
        <span className="truncate text-[11px] font-bold text-white">{bonusMsg}</span>
        <span className="shrink-0 pl-2 text-[10px] font-black uppercase tracking-wide text-white/80">More →</span>
      </div>

      {/* Orange odds/payout strip */}
      <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 shadow-[0_-6px_16px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-3 text-white">
          <span className="text-sm font-black">
            Odds <span className="tabular-nums">{totalOdds.toFixed(2)}</span>
          </span>
          <span className="h-4 w-px bg-white/30" />
          <span className="text-xs font-bold">
            Payout <span className="tabular-nums">{Math.round(payout).toLocaleString()}</span>
          </span>
        </div>
        <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-white">
          {count} picks <IconChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
