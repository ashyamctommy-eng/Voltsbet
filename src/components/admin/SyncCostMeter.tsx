"use client";

/**
 * Sync-cost meter — what the current market menu actually costs.
 *
 * The operator's question is never "how many markets did I pick", it is "what
 * does this cost me, and how long does my quota last". So this renders the
 * number they asked for (credits per sync run) and then translates it into the
 * two units a decision can be made in: runs remaining and credits per month.
 *
 * Three deliberate design rules, each of which would otherwise make the number
 * misleading:
 *
 *  1. SHOW THE SPLIT, never one blended figure. The list pass is charged per
 *     league on every run; the event pass is charged per featured EVENT. They
 *     respond to completely different knobs (trim leagues vs trim the extended
 *     menu), so a single total hides the only thing worth knowing.
 *  2. TIER 2 IS NOT A SYNC COST. It is billed when a customer opens a match, so
 *     it gets its own per-view line (with the TTL that stops repeat views
 *     paying) rather than being folded into the per-run total.
 *  3. SURFACE THE CAP. When MAX_CREDITS_PER_RUN is set and this estimate
 *     exceeds it, the sweep refuses to fetch ANYTHING — a silent no-op that
 *     looks like "the feed is broken". Say so before it happens.
 */

import type { SyncCostEstimate } from "@/lib/odds-cost-core";

const n = (v: number) => v.toLocaleString();

export default function SyncCostMeter({
  estimate,
  savedTotal,
  quotaRemaining,
  creditCap,
  throttleMinutes = 60,
  detail,
}: {
  estimate: SyncCostEstimate;
  /** Total for the last SAVED config — renders the delta while editing. */
  savedTotal?: number | null;
  quotaRemaining?: number | null;
  /** MAX_CREDITS_PER_RUN — above it the paid sweep refuses to run. */
  creditCap?: number | null;
  /** SYNC_THROTTLE_MINUTES — the real cadence, whatever the cron says. */
  throttleMinutes?: number;
  detail?: { markets: number; regions: number; ttlSeconds: number; perView?: number } | null;
}) {
  const { totalCredits, listCredits, eventCredits } = estimate;
  const runsPerDay = Math.max(1, Math.floor(1440 / Math.max(1, throttleMinutes)));
  const monthly = estimate.monthlyAt(runsPerDay);
  const monthlyQuarterHour = estimate.monthlyAt(96); // 15-minute cadence
  const perRun = totalCredits > 0 ? totalCredits : 0;
  const runsLeft = quotaRemaining != null && perRun > 0 ? Math.floor(quotaRemaining / perRun) : null;
  const overCap = creditCap != null && creditCap > 0 && totalCredits > creditCap;
  const delta = savedTotal != null ? totalCredits - savedTotal : 0;

  return (
    <div className="rounded-xl border border-line bg-card2/40 p-3.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-black tracking-tight">{n(totalCredits)}</span>
        <span className="text-xs font-bold text-ink2">credits per sync run</span>
        <span className="ml-auto rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-brand-text">
          recalculated live
        </span>
        {delta !== 0 && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
              delta > 0 ? "bg-bad/15 text-bad" : "bg-good/15 text-good"
            }`}
            title={`Last saved configuration: ${n(savedTotal ?? 0)} credits per run`}
          >
            {delta > 0 ? "+" : ""}
            {n(delta)} vs saved
          </span>
        )}
      </div>

      {/* the split — the two terms move for different reasons */}
      <div className="mt-2.5 space-y-1 border-t border-line/60 pt-2.5">
        <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] text-ink2">
          <span className="w-24 shrink-0">List pass</span>
          <span className="text-ink3">
            {estimate.listMarkets} markets × {estimate.regions} region
            {estimate.regions === 1 ? "" : "s"} × {n(estimate.leagues)} leagues
          </span>
          <span className="ml-auto font-bold tabular-nums text-ink">{n(listCredits)}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] text-ink2">
          <span className="w-24 shrink-0">Per-event pass</span>
          <span className="text-ink3">
            {estimate.extendedMarkets} markets × {estimate.regions} region
            {estimate.regions === 1 ? "" : "s"} × {n(estimate.maxEvents)} events
          </span>
          <span className="ml-auto font-bold tabular-nums text-ink">{n(eventCredits)}</span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/60 pt-2.5 font-mono text-[10.5px]">
        <span className="text-ink3">
          at a <b className="text-ink">{throttleMinutes}-min</b> cadence →{" "}
          <b className="text-ink">{n(monthly)}/mo</b>
        </span>
        {throttleMinutes > 15 && (
          <span className="text-ink3">
            at <b className="text-ink">15-min</b> → <b className="text-warn">{n(monthlyQuarterHour)}/mo</b>
          </span>
        )}
        {runsLeft != null && (
          <span className="text-ink3">
            quota left <b className="text-ink">{n(quotaRemaining ?? 0)}</b> →{" "}
            <b className={runsLeft < 24 ? "text-bad" : "text-good"}>≈ {n(runsLeft)} runs</b>
          </span>
        )}
      </div>

      {detail && detail.markets > 0 && (
        <div className="mt-2.5 border-t border-line/60 pt-2.5">
          <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] text-ink2">
            <span className="w-24 shrink-0">Tier 2 (view)</span>
            <span className="text-ink3">
              {detail.markets} markets × {detail.regions} region{detail.regions === 1 ? "" : "s"} per cold match view
            </span>
            <span className="ml-auto font-bold tabular-nums text-ink">{n(detail.perView ?? detail.markets * detail.regions)}</span>
          </div>
          <p className="mt-1 font-mono text-[10.5px] text-ink3">
            billed per customer view, not per run · cached {detail.ttlSeconds}s so repeat views are free
          </p>
        </div>
      )}

      {overCap && (
        <p className="mt-2.5 rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-2 text-[11px] font-semibold text-bad">
          ⛔ Above MAX_CREDITS_PER_RUN={n(creditCap ?? 0)} — the paid sweep will refuse to fetch anything and exit
          with “nothing was fetched”. Trim leagues or markets, or raise the cap.
        </p>
      )}
      {!overCap && totalCredits === 0 && (
        <p className="mt-2.5 text-[11px] font-semibold text-warn">
          ⚠ No markets selected — the sweep will have nothing to price.
        </p>
      )}
    </div>
  );
}
