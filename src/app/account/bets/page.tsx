import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import BetsList, { type BetsListItem } from "@/components/account/BetsList";
import { RANGE_PRESETS, PAGE_SIZE, dateWindow, pageNumber } from "@/lib/date-range";

export const dynamic = "force-dynamic";

/**
 * Bet history.
 *
 * Was: `take: 100`, no pagination, no total, no date filter — a customer
 * disputing an older bet could not reach it anywhere in the product. Now the
 * filtering and paging happen in the database and the URL carries the state, so
 * a support agent can be sent the exact view.
 *
 * The status list also drops the old `closed`/`settled` pair, which overlapped
 * (settled ⊇ closed) and differed only for partially-settled rows.
 */
const STATUS_FILTERS = ["all", "open", "won", "lost", "void", "cashed_out"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_WHERE: Record<StatusFilter, { status?: string }> = {
  all: {},
  open: { status: "OPEN" },
  won: { status: "WON" },
  lost: { status: "LOST" },
  void: { status: "VOID" },
  cashed_out: { status: "CASHED_OUT" },
};

export default async function MyBetsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string; status?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/bets");

  const sp = await searchParams;
  const status = (STATUS_FILTERS.find((s) => s === sp.status) ?? "all") as StatusFilter;
  const window = dateWindow(sp);
  // Search by bet code — the one thing a support conversation always needs,
  // and the code is already shown on the ticket.
  const q = (sp.q ?? "").trim();
  const scoped = { userId: user.id, ...(Object.keys(window).length ? { createdAt: window } : {}) };
  const where = {
    ...scoped,
    ...STATUS_WHERE[status],
    ...(q ? { code: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const page = pageNumber(sp);
  const [total, bets, byStatus] = await Promise.all([
    prisma.bet.count({ where }),
    prisma.bet.findMany({
      where,
      include: { selections: { select: { settled: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bet.groupBy({ by: ["status"], where: scoped, _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = { all: byStatus.reduce((n, c) => n + c._count._all, 0) };
  for (const c of byStatus) counts[c.status.toLowerCase()] = c._count._all;

  const items: BetsListItem[] = bets.map((b) => ({
    id: b.id,
    code: b.code,
    type: b.type,
    stake: b.stake.toString(),
    totalOdds: b.totalOdds.toString(),
    potentialWin: b.potentialWin.toString(),
    status: b.status,
    settledAt: b.settledAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    selectionCount: b.selections.length,
    settledCount: b.selections.filter((s) => s.settled).length,
  }));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">My Bets</h2>
      <BetsList
        bets={items}
        counts={counts}
        status={status}
        page={page}
        total={total}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        ranges={RANGE_PRESETS.map((r) => ({ ...r, on: (sp.range ?? "all") === r.id }))}
        query={{ range: sp.range, from: sp.from, to: sp.to, q: sp.q }}
        walletCur={user.currencyCode ?? "KES"}
      />
    </div>
  );
}
