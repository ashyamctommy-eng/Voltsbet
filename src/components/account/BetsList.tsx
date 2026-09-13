"use client";

import Link from "next/link";
import CashOutButton from "@/components/account/CashOutButton";
import { formatDateTime } from "@/lib/odds";
import { useTranslation } from "react-i18next";

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

/** Acca bonus tiers (mirrors the betslip). */
const BONUS_TIERS: Record<number, number> = { 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 10 };

const STATUS_COLOR: Record<string, string> = {
  OPEN: "bg-brand/15 text-brand-text",
  WON: "bg-green-500/15 text-green-400",
  LOST: "bg-red-500/15 text-red-400",
  VOID: "bg-hover-tint text-ink3",
  CASHED_OUT: "bg-amber-500/15 text-amber-400",
};

const STATUS_FILTERS = ["all", "open", "won", "lost", "void", "cashed_out"] as const;

/**
 * Bet history list.
 *
 * The filters used to hide six options behind a dropdown — for rows that were
 * already in memory, since filtering ran client-side over the fetched array.
 * Hiding instant options behind a click is backwards, and you couldn't see that
 * you had zero cashed-out bets without opening it.
 *
 * Now the server does the filtering and paging; this renders the state it is
 * given, as links, so the URL carries the view and a support agent can be sent
 * exactly what the customer is looking at.
 */
export default function BetsList({
  bets,
  counts,
  status,
  page,
  total,
  totalPages,
  ranges,
  query,
  walletCur,
}: {
  bets: BetsListItem[];
  /** Per-status totals for the chips (keys lower-cased, plus `all`). */
  counts: Record<string, number>;
  status: (typeof STATUS_FILTERS)[number];
  page: number;
  total: number;
  totalPages: number;
  ranges: { id: string; label: string; on: boolean }[];
  query: { range?: string; from?: string; to?: string; q?: string };
  walletCur: string;
}) {
  const { t } = useTranslation();

  // Plain GET form: works without JS, and the resulting URL is shareable —
  // exactly what a support agent needs to be sent.
  const hidden = Object.entries({ range: query.range, status })
    .filter(([, v]) => v && v !== "all")
    .map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />);

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, status, page: undefined, ...patch })) {
      if (v !== undefined && v !== "" && v !== "all") params.set(k, v);
    }
    const qs = params.toString();
    return `/account/bets${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-3">
      <form action="/account/bets" method="get" className="flex items-center gap-2">
        {hidden}
        <input
          className="input max-w-xs"
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search bet code…"
          aria-label="Search by bet code"
        />
        <button className="btn btn-ghost btn-sm" type="submit">Search</button>
      </form>

      {/* Status chips with counts — the whole filter set is visible at once. */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => {
          const on = f === status;
          return (
            <Link
              key={f}
              href={href({ status: f })}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                on ? "border-brand/50 bg-brand/15 font-bold text-ink" : "border-line font-semibold text-ink2 hover:text-ink"
              }`}
            >
              {t(`bet.filter.${f}`)} <span className="tabular-nums opacity-60">{counts[f] ?? counts[f.replace("cashed_out", "cashed_out")] ?? 0}</span>
            </Link>
          );
        })}
      </div>

      {/* Date range + honest position indicator. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ranges.map((r) => (
          <Link
            key={r.id}
            href={href({ range: r.id, page: undefined, from: undefined, to: undefined })}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
              r.on ? "bg-hover-tint text-ink" : "text-ink3 hover:text-ink"
            }`}
          >
            {r.label}
          </Link>
        ))}
        <span className="ml-auto text-[11px] text-ink3">
          Showing {bets.length === 0 ? 0 : (page - 1) * 20 + 1}–{(page - 1) * 20 + bets.length} of {total}
        </span>
      </div>

      {bets.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink3">
          {status === "all" ? t("bet.noBets") : t("bet.noBetsFiltered", { filter: t(`bet.filter.${status}`) })}{" "}
          <Link href="/sports" className="text-brand-text hover:underline">{t("bet.browseSports")}</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bets.map((bet) => {
            const tier = bet.type === "MULTIPLE" ? BONUS_TIERS[bet.selectionCount] : undefined;
            return (
              <Link key={bet.id} href={`/account/bets/${bet.id}`} className="card card-hover block p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold tracking-wide">#{bet.code}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${STATUS_COLOR[bet.status] ?? "bg-hover-tint text-ink3"}`}>
                    {bet.status}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-ink3">{formatDateTime(new Date(bet.createdAt))}</div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-card2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink2">
                    {bet.type === "MULTIPLE" ? t("bet.accaFold", { count: bet.selectionCount }) : t("bet.single")}
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

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-2.5">
                  <div className="text-xs text-ink2">
                    {t("bet.stake")}
                    {/* Money always carries its currency — wallet currency, the
                        one the balance and payouts actually use. */}
                    <div className="text-sm font-bold text-ink tabular-nums">
                      {walletCur} {Number(bet.stake).toLocaleString()}
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
                      <div className="text-sm font-extrabold tabular-nums text-green-400">
                        {walletCur} {Number(bet.potentialWin).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-2 pt-1 text-xs text-ink3">
          {page > 1 && (
            <Link href={href({ page: String(page - 1) })} className="rounded-lg border border-line px-2.5 py-1 font-bold text-ink2">
              ← Prev
            </Link>
          )}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(Math.max(1, totalPages - 4), page - 2)) + i;
            if (p < 1 || p > totalPages) return null;
            return (
              <Link
                key={p}
                href={href({ page: String(p) })}
                className={`rounded-lg border px-2.5 py-1 font-bold tabular-nums ${
                  p === page ? "border-brand/50 bg-brand/15 text-ink" : "border-line text-ink2"
                }`}
              >
                {p}
              </Link>
            );
          })}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={href({ page: String(page + 1) })} className="rounded-lg border border-line px-2.5 py-1 font-bold text-ink2">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
