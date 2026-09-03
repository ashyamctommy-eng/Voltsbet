"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/odds";
import CashOutButton from "@/components/account/CashOutButton";

/** Acca bonus tiers (mirrors the betslip). */
const BONUS_TIERS: Record<number, number> = { 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 10 };

export type BetsListItem = {
  id: string;
  code: string;
  type: string;
  stake: string;
  totalOdds: string;
  potentialWin: string;
  status: string;
  settledAt: string | null;
  createdAt: string;
  selectionCount: number;
  settledCount: number;
};

const FILTERS = ["all", "open", "closed", "settled", "won", "lost"] as const;
type FilterId = (typeof FILTERS)[number];

const STATUS_COLOR: Record<string, string> = {
  OPEN: "bg-brand/15 text-brand",
  WON: "bg-green-500/15 text-green-400",
  LOST: "bg-red-500/15 text-red-400",
  VOID: "bg-hover-tint text-ink3",
  CASHED_OUT: "bg-amber-500/15 text-amber-400",
};

/** My Bets — status-filter dropdown + Betika-style ticket cards. */
export default function BetsList({ bets }: { bets: BetsListItem[] }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterId>("all");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    switch (filter) {
      case "open":
        return bets.filter((b) => b.status === "OPEN");
      case "won":
        return bets.filter((b) => b.status === "WON");
      case "lost":
        return bets.filter((b) => b.status === "LOST");
      case "closed":
        return bets.filter((b) => b.status !== "OPEN"); // everything settled/voided
      case "settled":
        return bets.filter((b) => !!b.settledAt || b.status !== "OPEN");
      default:
        return bets;
    }
  }, [bets, filter]);

  const activeLabel = t(`bet.filter.${filter}`);

  return (
    <div className="space-y-4">
      {/* Status filter dropdown */}
      <div className="relative inline-block">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-sm font-bold text-ink transition-colors hover:border-line2"
        >
          {activeLabel}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-ink3" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div role="listbox" className="absolute left-0 top-full z-[95] mt-1.5 w-40 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-2xl">
              {FILTERS.map((fid) => (
                <button
                  key={fid}
                  role="option"
                  aria-selected={fid === filter}
                  onClick={() => {
                    setFilter(fid);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-hover-tint ${
                    fid === filter ? "text-brand" : "text-ink2 hover:text-ink"
                  }`}
                >
                  {t(`bet.filter.${fid}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink3">
          {filter === "all" ? t("bet.noBets") : t("bet.noBetsFiltered", { filter: t(`bet.filter.${filter}`) })}{" "}
          <Link href="/sports" className="text-brand hover:underline">{t("bet.browseSports")}</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((bet) => {
            const tier = bet.type === "MULTIPLE" ? BONUS_TIERS[bet.selectionCount] : undefined;
            return (
              <Link
                key={bet.id}
                href={`/account/bets/${bet.id}`}
                className="card card-hover block p-4"
              >
                {/* Ticket header: ID · status tag · timestamp */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold tracking-wide">#{bet.code}</span>
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${STATUS_COLOR[bet.status] ?? "bg-hover-tint text-ink3"}`}>
                      {bet.status}
                    </span>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-ink3">{formatDateTime(new Date(bet.createdAt))}</div>

                {/* Bonus badge + selections count */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-card2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink2">
                    {bet.type === "MULTIPLE"
                      ? t("bet.accaFold", { count: bet.selectionCount })
                      : t("bet.single")}
                  </span>
                  {tier && (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-black text-amber-400">
                      +{tier}% Bonus
                    </span>
                  )}
                  {bet.settledCount > 0 && (
                    <span className="rounded-full bg-hover-tint px-2.5 py-0.5 text-[10px] font-semibold text-ink3">
                      {t("bet.settledProgress", { settled: bet.settledCount, total: bet.selectionCount })}
                    </span>
                  )}
                </div>

                {/* Stake / potential */}
                <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-2.5">
                  <div className="text-xs text-ink2">
                    {t("bet.stake")}
                    <div className="text-sm font-bold text-ink tabular-nums">
                      {Number(bet.stake).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CashOutButton betId={bet.id} code={bet.code} status={bet.status} />
                    <div className="text-right text-xs text-ink2">
                      {bet.status === "WON"
                        ? t("bet.return")
                        : bet.status === "VOID"
                          ? t("bet.refunded")
                          : bet.status === "CASHED_OUT"
                            ? t("bet.cashedOut")
                            : t("bet.potentialPayout")}
                      <div className={`text-sm font-extrabold tabular-nums ${bet.status === "WON" ? "text-green-400" : "text-green-400"}`}>
                        {Number(bet.potentialWin).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
