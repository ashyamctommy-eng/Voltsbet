"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useBetSlip } from "@/components/BetSlipContext";
import { useToast } from "@/components/BetSlipContext";
import { useCurrency } from "@/components/CurrencyProvider";
import { apiFetch } from "@/lib/client";
import { fmtOdds } from "@/lib/odds";
import { IconX, IconTrash } from "@/components/icons";

type PlaceResponse = {
  bet: { id: string; code: string; status: string };
  totalOdds: number;
  potentialWin: number;
  acceptedOdds: string[];
};

type SlipAccount = {
  wallet: { balance: number; balanceLabel: string; currencyCode: string } | null;
  limits: { minStake: number; maxStake: number; maxPayout: number };
};

/** Betika-style quick stake INCREMENTS — each adds to the current stake. */
const QUICK_STAKES = [50, 100, 500, 1000];

export default function BetSlip() {
  const { items, remove, clear, open, setOpen, mode, setMode, stake, setStake, totalOdds, potentialWin } = useBetSlip();
  const { push } = useToast();
  const [placing, setPlacing] = useState(false);
  const [account, setAccount] = useState<SlipAccount | null>(null);
  const [oddsChange, setOddsChange] = useState<{ changed: { outcomeId: string; name: string; oldOdds: number; newOdds: number }[]; totalOdds: number; potentialWin: number } | null>(null);

  useEffect(() => {
    apiFetch<SlipAccount>("/api/account").then((r) => r.ok && setAccount(r.data));
  }, []);

  const stakeNum = parseFloat(stake) || 0;
  const balance = account?.wallet?.balance ?? 0;

  const slipBody = useMemo(
    () => ({
      items, mode, setMode, stake, setStake, totalOdds, potentialWin,
      remove, clear, place: () => place(false), placing,
      stakeNum, balance, minStake: account?.limits?.minStake ?? 50,
      account,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, mode, stake, totalOdds, potentialWin, placing, account]
  );

  async function place(accept: boolean) {
    if (items.length === 0) return;
    setPlacing(true);
    const res = await apiFetch<PlaceResponse>("/api/bets/place", {
      method: "POST",
      body: {
        selections: (mode === "SINGLE" ? items.slice(0, 1) : items).map((i) => ({
          outcomeId: i.outcomeId,
          oddsAtPlacement: i.odds,
        })),
        stake: stakeNum,
        type: mode === "SINGLE" && items.length === 1 ? "SINGLE" : mode,
        acceptOddsChange: accept,
      },
    });
    setPlacing(false);

    if (res.ok) {
      push("success", `Bet placed! ${res.data.bet.code}`);
      clear();
      setOpen(false);
      return;
    }
    if (res.error.code === "ODD_CHANGE" && res.data) {
      const d = res.data as { changed: { outcomeId: string; name: string; oldOdds: number; newOdds: number }[]; totalOdds: number; potentialWin: number };
      setOddsChange(d);
      return;
    }
    push("error", res.error.message);
  }

  return (
    <>
      {/* ── Desktop rail ── */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 hidden w-[350px] flex-col border-l border-line bg-[#0d1526] transition-transform duration-200 xl:flex ${
          open && items.length > 0 ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <SlipBody {...slipBody} onClose={() => setOpen(false)} desktop />
      </aside>

      {/* ── Mobile sheet (slides up from the sticky yellow bar) ── */}
      {open && items.length > 0 && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="fade-in absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-[#0d1526]">
            <div className="mx-auto mt-2.5 mb-1 h-1 w-10 shrink-0 rounded-full bg-line2" />
            <SlipBody {...slipBody} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* ── Odds-change confirmation ── */}
      {oddsChange && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="fade-in absolute inset-0 bg-black/70" onClick={() => setOddsChange(null)} />
          <div className="fade-in card relative w-full max-w-md p-6">
            <h3 className="text-lg font-bold">Odds have changed</h3>
            <p className="mt-1 text-sm text-ink2">
              The following odds moved since you added them. Place your bet at the new odds?
            </p>
            <div className="mt-4 space-y-2">
              {oddsChange.changed.map((c) => (
                <div key={c.outcomeId} className="flex items-center justify-between rounded-lg bg-card2 px-3 py-2 text-sm">
                  <span className="text-ink2">{c.name}</span>
                  <span className="font-semibold">
                    <span className="text-red-400 line-through">{fmtOdds(c.oldOdds)}</span>{" "}
                    <span className="text-green-400">→ {fmtOdds(c.newOdds)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
              <span className="text-ink2">New total odds</span>
              <span className="font-bold text-green-400">{fmtOdds(oddsChange.totalOdds)}</span>
            </div>
            <div className="mt-5 flex gap-3">
              <button className="btn btn-ghost flex-1" onClick={() => setOddsChange(null)}>
                Cancel
              </button>
              <button className="btn btn-primary flex-1" onClick={() => { setOddsChange(null); place(true); }}>
                Accept & Place Bet
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SlipBody(props: {
  items: ReturnType<typeof useBetSlip>["items"];
  mode: "SINGLE" | "MULTIPLE";
  setMode: (m: "SINGLE" | "MULTIPLE") => void;
  stake: string;
  setStake: (s: string) => void;
  totalOdds: number;
  potentialWin: number;
  remove: (id: string) => void;
  clear: () => void;
  place: () => void;
  placing: boolean;
  stakeNum: number;
  balance: number;
  minStake: number;
  account: SlipAccount | null;
  onClose: () => void;
  desktop?: boolean;
}) {
  const { items, mode, setMode, stake, setStake, totalOdds, potentialWin, remove, clear, place, placing, stakeNum, balance, minStake, account, onClose } = props;
  const { fmt } = useCurrency();
  const multiple = items.length > 1;
  const shown = mode === "SINGLE" ? items.slice(0, 1) : items;

  const canPlace = stakeNum > 0 && stakeNum >= minStake && stakeNum <= balance && !placing;
  const reason = stakeNum <= 0
    ? "Enter your stake"
    : stakeNum < minStake
      ? `Minimum stake is ${fmt(minStake)}`
      : stakeNum > balance
        ? "Insufficient balance"
        : "";

  /** Quick stake increments (+50/+100/+500/+1000) — add to the current stake. */
  const bumpStake = (q: number) => {
    const next = stakeNum + q;
    setStake(String(next));
  };

  return (
    <div className="flex max-h-[85vh] flex-col xl:h-full xl:max-h-none">
      {/* ── Header: Betslip · Clear All · ✕ ── */}
      <div className="sticky top-0 z-10 border-b border-line bg-[#0d1526] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold">Betslip</h2>
          <div className="flex items-center gap-3">
            {items.length > 0 && (
              <button className="text-xs font-semibold text-ink3 transition-colors hover:text-red-400" onClick={clear}>
                Clear All
              </button>
            )}
            <button
              className="rounded-lg p-1 text-ink3 transition-colors hover:bg-white/5 hover:text-ink"
              onClick={onClose}
              aria-label="Close betslip"
            >
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>
        {multiple && (
          <div className="mt-2 flex overflow-hidden rounded-lg border border-line2 text-xs font-semibold">
            <button
              className={`px-3 py-1.5 ${mode === "SINGLE" ? "bg-brand text-[#052e16]" : "text-ink2 hover:text-ink"}`}
              onClick={() => setMode("SINGLE")}
            >
              Singles
            </button>
            <button
              className={`px-3 py-1.5 ${mode === "MULTIPLE" ? "bg-brand text-[#052e16]" : "text-ink2 hover:text-ink"}`}
              onClick={() => setMode("MULTIPLE")}
            >
              Accumulator
            </button>
          </div>
        )}
      </div>

      {/* ── Body: selection cards ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <div className="mt-8 text-center">
            <div className="text-3xl">🎯</div>
            <p className="mt-3 text-sm text-ink3">Your bet slip is empty.</p>
            <p className="mt-1 text-xs text-ink3">Tap on odds to add selections.</p>
            <Link href="/sports" className="btn btn-ghost btn-sm mt-4" onClick={onClose}>
              Browse sports
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map((item) => (
              <div key={item.outcomeId} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-ink3">{item.competition}</div>
                    <div className="mt-0.5 truncate text-sm font-semibold">
                      {item.home} vs {item.away}
                    </div>
                    <div className="mt-0.5 text-xs text-ink2">
                      {item.market} · {item.outcome}
                    </div>
                  </div>
                  <button
                    className="rounded-lg p-1.5 text-ink3 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => remove(item.outcomeId)}
                    aria-label={`Remove ${item.home} vs ${item.away}`}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                  <span className="text-xs text-ink3">{item.label ? `${item.label} · ` : ""}Odds</span>
                  <span className="font-bold text-green-400">{fmtOdds(item.odds)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer: stake controls + green CTA ── */}
      {items.length > 0 && (
        <div className="sticky bottom-0 border-t border-line bg-[#0d1526] p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink2">Total Odds</span>
            <span className="text-base font-bold text-green-400">{totalOdds ? fmtOdds(totalOdds) : "—"}</span>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <label className="label mb-1" htmlFor="slip-stake">Stake</label>
              <span className="mb-1 text-[11px] text-ink3">
                Balance: <b className="text-green-400">{account?.wallet?.balanceLabel ?? "—"}</b>
              </span>
            </div>
            <input
              id="slip-stake"
              className="input"
              type="number"
              min="1"
              step="any"
              inputMode="decimal"
              placeholder="Enter stake"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {QUICK_STAKES.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="rounded-lg border border-line2 px-2.5 py-1.5 text-xs font-bold text-ink2 transition-colors hover:border-brand hover:text-brand"
                  onClick={() => bumpStake(q)}
                >
                  +{q.toLocaleString()}
                </button>
              ))}
              <button
                type="button"
                className="rounded-lg border border-line2 px-2.5 py-1.5 text-xs font-bold text-ink2 transition-colors hover:border-ink3"
                onClick={() => setStake(String(balance))}
              >
                Max
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-ink2">Potential Win</span>
            <span className="text-base font-bold text-green-400">
              {potentialWin > 0 ? fmt(Math.round(potentialWin * 100) / 100) : "—"}
            </span>
          </div>

          {/* Full-width green Place Bet CTA */}
          <button className="mt-4 w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3.5 text-base font-black text-[#052e16] shadow-[0_6px_20px_rgba(0,230,118,0.35)] transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none" disabled={!canPlace} onClick={place}>
            {placing ? "Placing…" : `Place Bet${stakeNum > 0 ? ` · ${fmt(Math.round(potentialWin * 100) / 100)}` : ""}`}
          </button>
          {reason ? (
            <p className="mt-2 text-center text-[11px] font-medium text-amber-400">{reason}</p>
          ) : (
            <p className="mt-2 text-center text-[11px] text-ink3">
              {mode === "MULTIPLE"
                ? `${items.length}-fold accumulator`
                : items.length > 1
                  ? "Single: places the first selection as a single bet"
                  : "Single bet"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
