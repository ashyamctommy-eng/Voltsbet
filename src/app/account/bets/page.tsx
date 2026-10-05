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
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string; status?: string; view?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/bets");

  const sp = await searchParams;
  const status = (STATUS_FILTERS.find((s) => s === sp.status) ?? "all") as StatusFilter;
  const view = (["all", "open", "live", "settled"].includes(sp.view ?? "") ? sp.view : "all") as "all" | "open" | "live" | "settled";
  const window = dateWindow(sp);
  // Search by bet code — the one thing a support conversation always needs,
  // and the code is already shown on the ticket.
  const q = (sp.q ?? "").trim();
  const scoped = { userId: user.id, ...(Object.keys(window).length ? { createdAt: window } : {}) };
  const viewWhere =
    view === "open"
      ? { status: "OPEN" }
      : view === "settled"
        ? { status: { in: ["WON", "LOST", "VOID", "CASHED_OUT"] } }
        : view === "live"
          ? { status: "OPEN", selections: { some: { game: { live: true } } } }
          : {};
  const where = {
    ...scoped,
    ...(q ? { code: { contains: q, mode: "insensitive" as const } } : {}),
    AND: [STATUS_WHERE[status], viewWhere],
  };

  const page = pageNumber(sp);
  const [total, bets, byStatus, liveCount] = await Promise.all([
    prisma.bet.count({ where }),
    prisma.bet.findMany({
      where,
      include: {
        selections: {
          include: {
            game: { include: { sport: true } },
            market: true,
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bet.groupBy({ by: ["status"], where: scoped, _count: { _all: true } }),
    prisma.bet.count({ where: { ...scoped, status: "OPEN", selections: { some: { game: { live: true } } } } }),
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
    selections: b.selections.map((s) => ({
      id: s.id,
      outcomeId: s.outcomeId,
      gameId: s.gameId,
      sport: s.game.sport?.name ?? "",
      competition: s.game.competitionName ?? "",
      home: s.game.homeName ?? "Home",
      away: s.game.awayName ?? "Away",
      startAt: s.game.startAt.toISOString(),
      status: s.game.status ?? "",
      live: s.game.live ?? false,
      market: s.marketName ?? s.market?.name ?? "",
      marketKey: s.market?.key ?? "",
      outcome: s.outcomeName ?? "",
      label: s.label,
      odds: Number(s.oddsAtPlacement),
      result: s.result,
      homeScore: s.game.homeScore ?? null,
      awayScore: s.game.awayScore ?? null,
      clock: s.game.clock ?? null,
      period: s.game.period ?? null,
    })),
  }));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">My Bets</h2>
      <BetsList
        bets={items}
        counts={counts}
        viewCounts={{
          all: byStatus.reduce((n, c) => n + c._count._all, 0),
          open: byStatus.find((c) => c.status === "OPEN")?._count._all ?? 0,
          live: liveCount,
          settled: byStatus.filter((c) => ["WON", "LOST", "VOID", "CASHED_OUT"].includes(c.status)).reduce((n, c) => n + c._count._all, 0),
        }}
        status={status}
        view={view}
        page={page}
        total={total}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        ranges={RANGE_PRESETS.map((r) => ({ ...r, on: (sp.range ?? "all") === r.id }))}
        query={{ range: sp.range, from: sp.from, to: sp.to, q: sp.q, view }}
        walletCur={user.currencyCode ?? "KES"}
      />
    </div>
  );
}
