"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useBetSlip } from "@/components/BetSlipContext";
import { useToast } from "@/components/BetSlipContext";
import { useCurrency } from "@/components/CurrencyProvider";
import { apiFetch } from "@/lib/client";
import { fmtOdds } from "@/lib/odds";
import { currencyPrefix } from "@/lib/currency-format";
import { selectionMarketLabel, tOutcome } from "@/lib/i18n";
import { teamContext } from "@/lib/market-labels";
import { IconX, IconTrash } from "@/components/icons";

type PlaceResponse = {
  bet: { id: string; code: string; status: string };
  totalOdds: number;
  potentialWin: number;
  acceptedOdds: string[];
};

/** Betika-style quick stake INCREMENTS — each adds to the current stake. */
const QUICK_STAKES = [50, 100, 500, 1000];

export default function BetSlip() {
  const { t } = useTranslation();
  const {
    items, remove, clear, open, setOpen, mode, setMode, stake, setStake, totalOdds, potentialWin,
    account, authed,
  } = useBetSlip();
  const router = useRouter();
  const { push } = useToast();
  const [placing, setPlacing] = useState(false);
  const [oddsChange, setOddsChange] = useState<{ changed: { outcomeId: string; name: string; oldOdds: number; newOdds: number }[]; totalOdds: number; potentialWin: number } | null>(null);

  // Idempotency key for the CURRENT submission: stable while the slip contents
  // don't change (so retrying the same place — network blip, double click —
  // can never place the same bet twice), fresh whenever the slip changes.
  const idemKeyRef = useRef<string>(newIdemKey());
  const slipContentsRef = useRef<string>("");

  function newIdemKey() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `vb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const stakeNum = parseFloat(stake) || 0;
  const balance = account?.balance ?? 0;

  // Lock background scrolling while the mobile betslip drawer is open.
  useEffect(() => {
    if (!(open && items.length > 0)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, items.length]);

  const slipBody = useMemo(
    () => ({
      items, mode, setMode, stake, setStake, totalOdds, potentialWin,
      remove, clear, place: () => place(false), placing,
      stakeNum, balance, minStake: account?.minStake ?? 50,
      account, authed,
      goDeposit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, mode, stake, totalOdds, potentialWin, placing, account, authed]
  );

  /**
   * Insufficient-balance / guest auth redirect (spec: smart betslip deposit
   * flow). Selections are NOT lost: BetSlipProvider caches them in
   * localStorage, so they're restored the moment the user lands back.
   *   signed-in  → straight to /account/deposit
   *   guest      → /register?redirect=/account/deposit (auto-login after
   *                signup sends them to fund the wallet)
   */
  const goDeposit = () => {
    setOpen(false);
    const dest = "/account/deposit";
    router.push(authed ? dest : `/register?redirect=${encodeURIComponent(dest)}`);
  };

  async function place(accept: boolean) {
    if (items.length === 0) return;
    // New slip contents → new idempotency key; same contents keep it so
    // retries of this exact submission replay the original bet.
    const contents = JSON.stringify({ items, stake, mode });
    if (slipContentsRef.current !== contents) {
      slipContentsRef.current = contents;
      idemKeyRef.current = newIdemKey();
    }
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
        idempotencyKey: idemKeyRef.current,
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
    // Wallet came up short server-side (stake raced a withdrawal/other bet) —
    // same smart redirect as the client-side guard. Guests get bounced to
    // register with their slip cached, never a dead-end error toast.
    if (res.error.code === "INSUFFICIENT_BALANCE" || res.error.code === "UNAUTHORIZED") {
      goDeposit();
      return;
    }
    push("error", res.error.message);
  }

  return (
    <>
      {/* ── Desktop rail ── */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 hidden w-[350px] flex-col border-l border-line bg-panel-bg transition-transform duration-200 xl:flex ${
          open && items.length > 0 ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <SlipBody {...slipBody} onClose={() => setOpen(false)} desktop visible={open && items.length > 0} />
      </aside>

      {/* ── Mobile sheet (slides up from the sticky yellow bar) ── */}
      {open && items.length > 0 && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="fade-in absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="sheet-up absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-panel-bg">
            <div className="mx-auto mt-2.5 mb-1 h-1 w-10 shrink-0 rounded-full bg-line2" />
            <SlipBody {...slipBody} onClose={() => setOpen(false)} visible />
          </div>
        </div>
      )}

      {/* ── Odds-change confirmation ── */}
      {oddsChange && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="fade-in absolute inset-0 bg-black/70" onClick={() => setOddsChange(null)} />
          <div className="fade-in card relative w-full max-w-md p-6">
            <h3 className="text-lg font-bold">{t("betslip.oddsChanged")}</h3>
            <p className="mt-1 text-sm text-ink2">{t("betslip.oddsChangedHint")}</p>
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
              <span className="text-ink2">{t("betslip.newTotalOdds")}</span>
              <span className="font-bold text-green-400">{fmtOdds(oddsChange.totalOdds)}</span>
            </div>
            <div className="mt-5 flex gap-3">
              <button className="btn btn-ghost flex-1" onClick={() => setOddsChange(null)}>
                {t("betslip.cancel")}
              </button>
              <button className="btn btn-primary flex-1" onClick={() => { setOddsChange(null); place(true); }}>
                {t("betslip.acceptAndPlace")}
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
  account: { balance: number; currencyCode: string; minStake: number; maxStake: number; maxPayout: number } | null;
  authed: boolean | null;
  /** Smart deposit/auth redirect (insufficient balance / guest). */
  goDeposit: () => void;
  onClose: () => void;
  desktop?: boolean;
  visible?: boolean;
}) {
  const { items, mode, setMode, stake, setStake, totalOdds, potentialWin, remove, clear, place, placing, stakeNum, balance, minStake, account, authed, goDeposit, onClose, visible } = props;
  const { t } = useTranslation();
  const stakeRef = useRef<HTMLInputElement>(null);

  // Money is ALWAYS the user's account (wallet) currency — USD or KES. The
  // slip never converts to a display currency: the stake is wagered in the
  // wallet currency, so every shown amount must match what is actually bet.
  const { formatCurrency, defaultCode } = useCurrency();
  // Wallet currency (USD | KES) — NEVER the display currency: the stake is
  // wagered in the wallet currency so every label must match it exactly.
  const moneyCur = account?.currencyCode ?? defaultCode;
  const moneyPrefix = currencyPrefix(moneyCur);
  const widePrefix = moneyPrefix.length >= 3;

  // Auto-focus the stake input the moment the slip opens — one less tap
  // between picking an outcome and placing the bet.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => stakeRef.current?.focus({ preventScroll: true }), 250);
    return () => clearTimeout(t);
  }, [visible]);

  const multiple = items.length > 1;
  const shown = mode === "SINGLE" ? items.slice(0, 1) : items;

  const stakeValid = stakeNum > 0 && stakeNum >= minStake;
  const signedIn = authed === true;
  const guest = authed === false;
  // Insufficient funds (signed-in only — guests have no wallet to compare).
  const insufficient = signedIn && stakeValid && stakeNum > balance;
  // Normal path: signed in with enough balance.
  const canPlace = signedIn && stakeValid && !insufficient && !placing;
  // Guests may always tap the CTA — it routes them to register (slip cached).
  const ctaReady = (canPlace || insufficient || guest) && !placing && stakeValid;
  // Blocked only while the stake is unusable, placement is in flight, or the
  // auth snapshot hasn't resolved yet (avoids mis-routing on a slow fetch).
  const ctaDisabled = placing || !stakeValid || authed === null || !ctaReady;
  const reason = stakeNum <= 0
    ? t("betslip.enterStakeHint")
    : stakeNum < minStake
      ? t("betslip.minStake", { amount: formatCurrency(minStake, moneyCur) })
      : insufficient
        ? t("betslip.insufficientBalance")
        : "";

  /** Quick stake increments (+50/+100/+500/+1000) — add to the current stake. */
  const bumpStake = (q: number) => {
    const next = stakeNum + q;
    setStake(String(next));
  };

  return (
    <div className="flex min-h-0 max-h-[85vh] flex-col xl:h-full xl:max-h-none">
      {/* ── Header: Betslip · Clear All · ✕ ── */}
      <div className="sticky top-0 z-10 border-b border-line bg-panel-bg px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold">{t("betslip.title")}</h2>
          <div className="flex items-center gap-3">
            {items.length > 0 && (
              <button className="text-xs font-semibold text-ink3 transition-colors hover:text-red-400" onClick={clear}>
                {t("betslip.clearAll")}
              </button>
            )}
            <button
              className="rounded-lg p-1 text-ink3 transition-colors hover:bg-hover-tint hover:text-ink"
              onClick={onClose}
              aria-label={t("betslip.close")}
            >
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>
        {multiple && (
          <div className="mt-1.5 flex overflow-hidden rounded-lg border border-line2 text-xs font-semibold">
            <button
              className={`px-3 py-1.5 ${mode === "SINGLE" ? "bg-brand text-[#052e16]" : "text-ink2 hover:text-ink"}`}
              onClick={() => setMode("SINGLE")}
            >
              {t("betslip.singles")}
            </button>
            <button
              className={`px-3 py-1.5 ${mode === "MULTIPLE" ? "bg-brand text-[#052e16]" : "text-ink2 hover:text-ink"}`}
              onClick={() => setMode("MULTIPLE")}
            >
              {t("betslip.accumulator")}
            </button>
          </div>
        )}
      </div>

      {/* ── Body: selection cards ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {items.length === 0 ? (
          <div className="mt-8 text-center">
            <div className="text-3xl">🎯</div>
            <p className="mt-3 text-sm text-ink3">{t("betslip.empty")}</p>
            <p className="mt-1 text-xs text-ink3">{t("betslip.emptyHint")}</p>
            <Link href="/sports" className="btn btn-ghost btn-sm mt-4" onClick={onClose}>
              {t("betslip.browseSports")}
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5">
            {shown.map((item) => (
              <div key={item.outcomeId} className="card px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-ink3">{item.competition}</div>
                    <div className="mt-0.5 truncate text-sm font-semibold">
                      {item.home} vs {item.away}
                    </div>
                    <div className="mt-0.5 text-xs text-ink2">
                      {selectionMarketLabel(item.market, item.outcome)} ·{" "}
                      {teamContext(tOutcome(item.outcome), item.marketKey ?? "", item.home, item.away)}
                    </div>
                  </div>
                  <button
                    className="rounded-lg p-1.5 text-ink3 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => remove(item.outcomeId)}
                    aria-label={`${t("betslip.remove")} ${item.home} vs ${item.away}`}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
                  <span className="text-xs text-ink3">{item.label ? `${item.label} · ` : ""}{t("betslip.odds")}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold text-green-400 transition-colors ${
                      item.trend === "up" ? "odds-flash-up" : item.trend === "down" ? "odds-flash-down" : ""
                    }`}
                  >
                    {item.trend === "up" ? "▲ " : item.trend === "down" ? "▼ " : ""}
                    {fmtOdds(item.odds)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer: stake controls + green CTA ── */}
      {items.length > 0 && (
        <div className="sticky bottom-0 border-t border-line bg-panel-bg px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink2">{t("betslip.totalOdds")}</span>
            <span className="text-base font-bold text-green-400">{totalOdds ? fmtOdds(totalOdds) : "—"}</span>
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between">
              <label className="label mb-1" htmlFor="slip-stake">{t("betslip.stake")}</label>
              <span className="mb-1 text-[11px] text-ink3">
                {t("betslip.balance")} <b className="text-green-400">{account ? formatCurrency(balance, moneyCur) : "—"}</b>
              </span>
            </div>
            <div className="relative">
              {/* Currency prefix as a distinct left label — padded by symbol
                  length so codes/symbols never overlap the value. */}
              <span
                className={`pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center rounded bg-hover-tint px-1.5 py-0.5 text-[11px] font-black tracking-wide text-ink2 ${
                  widePrefix ? "w-9 justify-center" : ""
                }`}
              >
                {moneyPrefix}
              </span>
              <input
                id="slip-stake"
                ref={stakeRef}
                className={`input ${widePrefix ? "!pl-16" : "!pl-9"}`}
                type="number"
                min="1"
                step="any"
                inputMode="decimal"
                placeholder={t("betslip.enterStake")}
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
            </div>
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
                {t("betslip.max")}
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-ink2">{t("betslip.potentialWin")}</span>
            <span className="text-base font-bold text-green-400">
              {potentialWin > 0 ? formatCurrency(potentialWin, moneyCur) : "—"}
            </span>
          </div>

          {/* Full-width green CTA — Place Bet, or the smart deposit/auth
              redirect when the wallet can't cover the stake (or it's a
              guest). Label stays clean: the Potential Win row above already
              shows the return — no duplicated amount in the button. */}
          <button
            className="mt-2.5 w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 text-base font-black text-[#052e16] shadow-[0_6px_20px_rgba(0,230,118,0.35)] transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            disabled={ctaDisabled}
            onClick={() => {
              if (insufficient || guest) {
                goDeposit();
                return;
              }
              if (canPlace) place();
            }}
          >
            {placing
              ? t("betslip.placing")
              : insufficient || guest
                ? t("nav.deposit")
                : t("betslip.placeBet")}
          </button>
          {reason ? (
            <p className="mt-3 text-center text-[11px] font-medium text-amber-400">{reason}</p>
          ) : (
            <p className="mt-3 text-center text-[11px] text-ink3">
              {mode === "MULTIPLE"
                ? t("betslip.accumulatorFold", { count: items.length })
                : items.length > 1
                  ? t("betslip.singleFirst")
                  : t("betslip.singleBet")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
