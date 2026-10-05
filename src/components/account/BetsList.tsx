"use client";

import Link from "next/link";
import BetActions, { type DetailSelection } from "@/components/account/BetActions";
import BetLegRow from "@/components/account/BetLegRow";
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
  selections: TicketSelection[];
};

/** Acca bonus tiers (mirrors the betslip). */
const BONUS_TIERS: Record<number, number> = { 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 10 };
const STATUS_FILTERS = ["all", "open", "won", "lost", "void", "cashed_out"] as const;
const VIEWS = [
  { id: "open", label: "Open" },
  { id: "live", label: "Live" },
  { id: "settled", label: "Settled" },
] as const;

function amount(value: string | number | null | undefined): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  try {
    return formatDateTime(date);
  } catch {
    return date.toLocaleString();
  }
}

type TicketSelection = DetailSelection;

function statusTone(status: string): string {
  return status === "WON"
    ? "border-2 border-emerald-500 shadow-[0_0_18px_rgba(16,185,129,.12)]"
    : "border border-slate-800/80";
}

/**
 * Bet history tickets. Query-string controls stay server-backed and shareable;
 * the full detail route remains the canonical ticket view.
 */
export default function BetsList({
  bets,
  counts,
  viewCounts,
  status,
  view,
  page,
  total,
  totalPages,
  ranges,
  query,
  walletCur,
}: {
  bets: BetsListItem[];
  counts: Record<string, number>;
  viewCounts: Record<string, number>;
  status: (typeof STATUS_FILTERS)[number];
  view: "all" | "open" | "live" | "settled";
  page: number;
  total: number;
  totalPages: number;
  ranges: { id: string; label: string; on: boolean }[];
  query: { range?: string; from?: string; to?: string; q?: string; view?: string };
  walletCur: string;
}) {
  const { t } = useTranslation();

  const hidden = Object.entries({
    range: query.range,
    from: query.from,
    to: query.to,
    status: status !== "all" ? status : undefined,
    view: view !== "all" ? view : undefined,
  })
    .filter(([, value]) => value)
    .map(([key, value]) => <input key={key} type="hidden" name={key} value={String(value)} />);

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, status, page: undefined, ...patch })) {
      if (value !== undefined && value !== "" && value !== "all") params.set(key, value);
    }
    const qs = params.toString();
    return `/account/bets${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full gap-1 rounded-full border border-[#2d3832] bg-[#111714] p-1 sm:w-auto">
          {VIEWS.map((item) => {
            const active = view === item.id;
            return (
              <Link
                key={item.id}
                href={href({ view: item.id, status: "all" })}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-extrabold transition-colors sm:flex-none sm:px-4 ${
                  active ? "bg-white font-bold text-slate-950 shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                {item.label}
                <span className={`font-mono text-[10px] tabular-nums ${active ? "text-slate-600" : "opacity-60"}`}>
                  {viewCounts[item.id] ?? 0}
                </span>
              </Link>
            );
          })}
        </div>

        <form action="/account/bets" method="get" className="flex items-center gap-2">
          {hidden}
          <input
            className="input min-w-0 flex-1 sm:w-52"
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Search ticket code…"
            aria-label="Search by bet code"
          />
          <button className="btn btn-ghost btn-sm" type="submit">Search</button>
        </form>
      </div>

      {/* Exact bet-status filters remain independently addressable. */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((filter) => {
          const selected = filter === status;
          const viewForStatus =
            filter === "open"
              ? "open"
              : ["won", "lost", "void", "cashed_out"].includes(filter)
                ? "settled"
                : "all";
          return (
            <Link
              key={filter}
              href={href({ status: filter, view: viewForStatus })}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                selected
                  ? "border-[#4c8065] bg-[#1b3327] text-[#91dfb3]"
                  : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-white"
              }`}
            >
              {t(`bet.filter.${filter}`)} <span className="ml-0.5 font-mono tabular-nums opacity-65">{counts[filter] ?? 0}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {ranges.map((range) => (
          <Link
            key={range.id}
            href={href({ range: range.id, page: undefined, from: undefined, to: undefined })}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
              range.on ? "bg-[#27332c] text-ink" : "text-ink3 hover:text-ink"
            }`}
          >
            {range.label}
          </Link>
        ))}
        <span className="ml-auto text-[10px] font-medium text-ink3">
          Showing {bets.length === 0 ? 0 : (page - 1) * 20 + 1}–{(page - 1) * 20 + bets.length} of {total}
        </span>
      </div>

      {bets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#38463e] bg-[#151c18] px-5 py-10 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#3b5144] bg-[#1b2a21] text-[#82d9a9]">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M7 3.75h10a2 2 0 0 1 2 2v14.5l-2.5-1.7-2.5 1.7-2.5-1.7-2.5 1.7-2.5-1.7-2.5 1.7V5.75a2 2 0 0 1 2-2Z" />
              <path d="M8.5 8h7M8.5 11.5h7" />
            </svg>
          </div>
          <p className="text-sm font-bold text-ink">
            {status === "all" ? t("bet.noBets") : t("bet.noBetsFiltered", { filter: t(`bet.filter.${status}`) })}
          </p>
          <p className="mt-1 text-xs text-ink3">Your tickets will appear here once you place a bet.</p>
          <Link href="/sports" className="mt-4 inline-flex rounded-full bg-[#286c4c] px-4 py-2 text-xs font-extrabold text-[#eff8f2] hover:bg-[#327d59]">
            {t("bet.browseSports")}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bets.map((bet) => {
            const tier = bet.type === "MULTIPLE" ? BONUS_TIERS[bet.selectionCount] : undefined;
            const settled = ["WON", "LOST", "VOID", "CASHED_OUT"].includes(bet.status);
            const returnLabel =
              bet.status === "WON" ? t("bet.return") :
                bet.status === "VOID" ? t("bet.refunded") :
                  bet.status === "CASHED_OUT" ? t("bet.cashedOut") :
                    bet.status === "LOST" ? "Return" : t("bet.potentialPayout");
            const returnValue =
              bet.status === "VOID" ? bet.stake :
                bet.status === "LOST" ? 0 :
                  bet.status === "CASHED_OUT" ? null : bet.potentialWin;
            const actionSelections = bet.selections;

            return (
              <article key={bet.id} className={`overflow-hidden rounded-2xl bg-[#1a232a] shadow-lg ${statusTone(bet.status)}`}>
                <div className="p-3.5 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-emerald-400">
                        <span className="font-mono text-lg font-extrabold tabular-nums">{walletCur} {amount(bet.stake)}</span>
                        <span aria-hidden="true" className="text-[#4e8064]">·</span>
                        <span>{bet.type === "MULTIPLE" ? t("bet.accaFold", { count: bet.selectionCount }) : t("bet.single")}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink3">
                        <span className="font-extrabold tracking-wide text-ink2">#{bet.code}</span>
                        <span>{dateLabel(bet.createdAt)}</span>
                        {bet.settledCount > 0 && (
                          <span className="rounded-full bg-[#28332d] px-2 py-0.5 font-semibold">
                            {t("bet.settledProgress", { settled: bet.settledCount, total: bet.selectionCount })}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`shrink-0 px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${
                      bet.status === "WON"
                        ? "rounded-bl-xl rounded-tr-xl bg-emerald-400 text-slate-950"
                        : bet.status === "LOST"
                          ? "rounded-lg bg-slate-700/80 font-semibold text-slate-300"
                          : bet.status === "OPEN"
                            ? "rounded-lg bg-emerald-400/15 text-emerald-300"
                            : "rounded-lg bg-slate-700/80 text-slate-300"
                    }`}>
                      {bet.status.replace("_", " ")}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <BetActions
                      bet={{
                        id: bet.id,
                        code: bet.code,
                        status: bet.status,
                        createdAt: bet.createdAt,
                        selections: actionSelections,
                      }}
                      shareUrl={`/account/bets/${bet.id}`}
                      showCashOut={false}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {tier && (
                      <span className="rounded-full border border-[#655128] bg-[#30291a] px-2.5 py-0.5 text-[9px] font-black text-[#d9c177]">
                        +{tier}% ACCA bonus
                      </span>
                    )}
                    <span className="rounded-full bg-[#222c26] px-2.5 py-0.5 font-mono text-[9px] font-bold tabular-nums text-ink3">
                      {Number.isFinite(Number(bet.totalOdds)) ? amount(bet.totalOdds) : "—"} total odds
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {bet.selections.length > 0 ? bet.selections.map((selection) => (
                      <BetLegRow key={selection.id} selection={selection} />
                    )) : (
                      <div className="rounded-xl border border-[#2b3832] bg-[#121916] px-3 py-4 text-xs text-ink3">
                        Selection details are unavailable for this ticket.
                      </div>
                    )}
                  </div>

                  {settled && (
                    <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                      bet.status === "WON"
                        ? "border-[#397354] bg-[#1a3426] text-[#8ce0b2]"
                        : bet.status === "LOST"
                          ? "border-[#373936] bg-[#202220] text-[#b1aaa5]"
                          : bet.status === "VOID"
                            ? "border-[#39483e] bg-[#202a23] text-[#b5c9bb]"
                            : "border-[#55482b] bg-[#2c281d] text-[#d8c47f]"
                    }`}>
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em]">
                          {bet.status === "WON" ? "Ticket won" :
                            bet.status === "LOST" ? "Ticket lost" :
                              bet.status === "VOID" ? "Stake refunded" : "Cash out complete"}
                        </div>
                        <div className="mt-0.5 text-[10px] opacity-75">
                          {bet.status === "WON" ? "Winning return credited to your wallet" :
                            bet.status === "LOST" ? "No return on this ticket" :
                              bet.status === "VOID" ? "Your original stake was returned" :
                                "Cash-out was confirmed"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-mono text-xs font-extrabold tabular-nums">
                        {bet.status === "LOST" ? `${walletCur} 0` :
                          bet.status === "CASHED_OUT" ? "Confirmed" : `${walletCur} ${amount(returnValue)}`}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-[#303b35] pt-3">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-[.12em] text-ink3">{t("bet.stake")}</div>
                      <div className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-ink">{walletCur} {amount(bet.stake)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-[.12em] text-ink3">{returnLabel}</div>
                      <div className={`mt-0.5 font-mono text-sm font-extrabold tabular-nums ${
                        bet.status === "LOST" ? "text-ink3" : bet.status === "WON" ? "text-[#78dba6]" : "text-ink"
                      }`}>
                        {returnValue === null ? "See confirmation" : `${walletCur} ${amount(returnValue)}`}
                      </div>
                    </div>
                  </div>

                  {bet.status === "OPEN" && (
                    <div className="mt-3">
                      <CashOutButton betId={bet.id} code={bet.code} status={bet.status} variant="ticket" />
                    </div>
                  )}
                  <div className="mt-2 flex justify-end">
                    <Link
                      href={`/account/bets/${bet.id}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white"
                    >
                      View full ticket
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M3 8h9M8 4l4 4-4 4" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav aria-label="Bet history pages" className="flex flex-wrap items-center gap-2 pt-1 text-xs text-ink3">
          {page > 1 && (
            <Link href={href({ page: String(page - 1) })} className="rounded-lg border border-[#344139] px-2.5 py-1.5 font-bold text-ink2">
              ← Prev
            </Link>
          )}
          {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
            const current = Math.max(1, Math.min(Math.max(1, totalPages - 4), page - 2)) + index;
            if (current < 1 || current > totalPages) return null;
            return (
              <Link
                key={current}
                href={href({ page: String(current) })}
                aria-current={current === page ? "page" : undefined}
                className={`rounded-lg border px-2.5 py-1.5 font-bold tabular-nums ${
                  current === page ? "border-[#4c8065] bg-[#1b3327] text-[#91dfb3]" : "border-[#344139] text-ink2"
                }`}
              >
                {current}
              </Link>
            );
          })}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={href({ page: String(page + 1) })} className="rounded-lg border border-[#344139] px-2.5 py-1.5 font-bold text-ink2">
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
