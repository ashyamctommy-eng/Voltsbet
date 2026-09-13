import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/odds";
import { ledgerAmount } from "@/lib/wallet-display";
import { RANGE_PRESETS, PAGE_SIZE, dateWindow, pageNumber, withParam } from "@/lib/date-range";

export const dynamic = "force-dynamic";

/**
 * Transaction ledger.
 *
 * Was: newest 100 rows, no paging, no filter, and — the actual defect — each row
 * printed the CONVERTED amount next to the transaction's ORIGINAL currency code
 * ("+$15.20 (KES)": a dollar figure labelled Kenyan shilling).
 *
 * Now: server-side filtering + paging, and money follows the one rule — the
 * wallet currency, raw, is the number; the display currency is a smaller hint
 * beside it. See lib/wallet-display.
 */

/** Type groups, matched on the stored type string. */
const TYPE_FILTERS = [
  { id: "all", label: "All", where: () => ({}) },
  { id: "deposits", label: "Deposits", where: () => ({ type: { contains: "DEPOSIT" } }) },
  { id: "withdrawals", label: "Withdrawals", where: () => ({ type: { contains: "WITHDRAW" } }) },
  { id: "bets", label: "Bets", where: () => ({ OR: [{ type: { contains: "BET" } }, { type: { contains: "CASH_OUT" } }] }) },
  { id: "bonuses", label: "Bonuses", where: () => ({ type: { contains: "BONUS" } }) },
] as const;

type TypeId = (typeof TYPE_FILTERS)[number]["id"];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string; type?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/transactions");

  const sp = await searchParams;
  const s = await getSettings();
  const walletCur = user.currencyCode ?? "KES";
  const displayCur = user.displayCurrencyCode ?? s.currencyDefault;

  const typeId = (TYPE_FILTERS.find((t) => t.id === sp.type)?.id ?? "all") as TypeId;
  const typeWhere = TYPE_FILTERS.find((t) => t.id === typeId)!.where();
  const window = dateWindow(sp);
  const q = (sp.q ?? "").trim();
  const where = {
    userId: user.id,
    ...(Object.keys(window).length ? { createdAt: window } : {}),
    ...typeWhere,
    ...(q ? { reference: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const page = pageNumber(sp);
  const [total, rows, typeCounts] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    // Counts for the filter chips, so "you have 0 withdrawals this month" is
    // visible without opening anything.
    prisma.transaction.groupBy({ by: ["type"], where: { userId: user.id, ...(Object.keys(window).length ? { createdAt: window } : {}) }, _count: { _all: true } }),
  ]);

  const countFor = (id: TypeId) => {
    if (id === "all") return typeCounts.reduce((n, c) => n + c._count._all, 0);
    const needle = id === "deposits" ? "DEPOSIT" : id === "withdrawals" ? "WITHDRAW" : id === "bonuses" ? "BONUS" : null;
    return typeCounts
      .filter((c) => (needle ? c.type.includes(needle) : c.type.includes("BET") || c.type.includes("CASH_OUT")))
      .reduce((n, c) => n + c._count._all, 0);
  };

  const base = { range: sp.range, from: sp.from, to: sp.to, type: sp.type, q: sp.q };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const labels = await Promise.all(
    rows.map(async (t) => ({
      id: t.id,
      money: await ledgerAmount(Number(t.amount), walletCur, displayCur),
      balance: await ledgerAmount(Number(t.newBalance), walletCur, displayCur),
    })),
  );
  const labelById = new Map(labels.map((l) => [l.id, l]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Transactions</h2>
        <span className="text-[11px] text-ink3">
          all amounts in your wallet currency ({walletCur})
          {displayCur !== walletCur && <> · ≈ shown in {displayCur}</>}
        </span>
      </div>

      <form action="/account/transactions" method="get" className="flex items-center gap-2">
        {sp.range && <input type="hidden" name="range" value={sp.range} />}
        {sp.type && <input type="hidden" name="type" value={sp.type} />}
        <input
          className="input max-w-xs"
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search reference…"
          aria-label="Search by transaction reference"
        />
        <button className="btn btn-ghost btn-sm" type="submit">Search</button>
      </form>

      {/* Type filters with counts */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_FILTERS.map((t) => {
          const on = t.id === typeId;
          return (
            <Link
              key={t.id}
              href={withParam({ ...base, page: undefined }, { type: t.id })}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                on ? "border-brand/50 bg-brand/15 font-bold text-ink" : "border-line font-semibold text-ink2 hover:text-ink"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-60">{countFor(t.id)}</span>
            </Link>
          );
        })}
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_PRESETS.map((r) => {
          const on = (sp.range ?? "all") === r.id;
          return (
            <Link
              key={r.id}
              href={withParam({ ...base, page: undefined, from: undefined, to: undefined }, { range: r.id })}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                on ? "bg-hover-tint text-ink" : "text-ink3 hover:text-ink"
              }`}
            >
              {r.label}
            </Link>
          );
        })}
        <span className="ml-auto text-[11px] text-ink3">
          Showing {rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + rows.length} of{" "}
          {total}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink3">
          No transactions match this filter.
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((t) => {
            const m = labelById.get(t.id)!;
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold capitalize">{t.type.replace("_", " ").toLowerCase()}</div>
                  <div className="truncate text-xs text-ink3">
                    {formatDateTime(t.createdAt)}
                    {t.reference ? ` · Ref: ${t.reference}` : ""}
                  </div>
                  {t.reason && <div className="truncate text-xs text-ink3">{t.reason}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {/* The number is in the wallet's currency — the SAME currency
                      the balance and the withdrawal work in. */}
                  <div className={`font-bold tabular-nums ${m.money.positive ? "text-good" : "text-bad"}`}>
                    {m.money.positive ? "+" : "−"} {m.money.walletLabel}
                  </div>
                  <div className="text-[11px] text-ink3">
                    {m.money.displayLabel ? `≈ ${m.money.displayLabel} · ` : ""}bal {m.balance.walletLabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs text-ink3">
          {page > 1 && (
            <Link href={withParam(base, { page: String(page - 1) })} className="rounded-lg border border-line px-2.5 py-1 font-bold text-ink2">
              ← Prev
            </Link>
          )}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
            if (p < 1 || p > totalPages) return null;
            return (
              <Link
                key={p}
                href={withParam(base, { page: String(p) })}
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
            <Link href={withParam(base, { page: String(page + 1) })} className="rounded-lg border border-line px-2.5 py-1 font-bold text-ink2">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
