import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/odds";
import {
  CARD_MARKET_KEYS,
  CORNER_MARKET_KEYS,
  HALF_TIME_MARKET_KEYS,
} from "@/lib/settlement/resolve-stats";

export const dynamic = "force-dynamic";

/**
 * SETTLEMENT QUEUE — everything waiting on a human, in one place.
 *
 * WHY THIS EXISTS
 * The old route to a stuck bet was: Admin → Games → "All statuses" → scroll.
 * With a few hundred fixtures and no search box, finding the one match that was
 * holding a customer's money was luck. Meanwhile the only signal that something
 * was wrong came from the customer.
 *
 * This page asks the question the operator actually has: "what has started and
 * is still not settled?" It lists it two ways — the BETS (money, one row per
 * customer waiting) and the FIXTURES (the work itself, with what each one
 * needs). Every row links straight to the match page where it gets settled.
 */

/** A bet whose match kicked off longer ago than this counts as waiting. */
const WAITING_HOURS = 6;

type Need = "RESULT" | "HT" | "STATS" | "AUTO" | "REVIEW";

type Fixture = {
  id: string;
  homeName: string;
  awayName: string;
  status: string;
  startAt: Date;
  picks: number;
  stake: number;
  unsettled: number;
  needs: Set<Need>;
};

const NEED_LABEL: Record<Need, string> = {
  RESULT: "set the final score (status not FINISHED)",
  HT: "half-time score",
  STATS: "external stats (corners / cards)",
  AUTO: "auto-settles on the next cron",
  REVIEW: "a per-outcome call",
};

const NEED_STYLE: Record<Need, string> = {
  RESULT: "bg-amber-500/15 text-amber-400",
  HT: "bg-amber-500/15 text-amber-400",
  STATS: "bg-hover-tint text-ink2",
  AUTO: "bg-emerald-500/15 text-emerald-400",
  REVIEW: "bg-hover-tint text-ink2",
};

function needFor(marketKey: string, outcomeName: string): Need {
  if (outcomeName.toLowerCase().startsWith("any other")) return "AUTO";
  if (HALF_TIME_MARKET_KEYS.has(marketKey)) return "HT";
  if (CORNER_MARKET_KEYS.has(marketKey) || CARD_MARKET_KEYS.has(marketKey)) return "STATS";
  return "REVIEW";
}

function hoursSince(d: Date): number {
  return Math.round((new Date().getTime() - d.getTime()) / 3_600_000);
}

export default async function SettlementQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const gameSearch = term
    ? {
        OR: [
          { homeName: { contains: term, mode: "insensitive" as const } },
          { awayName: { contains: term, mode: "insensitive" as const } },
        ],
      }
    : {};
  const cutoff = new Date(new Date().getTime() - WAITING_HOURS * 60 * 60 * 1000);

  const [bets, outcomes] = await Promise.all([
    // The money: one row per customer whose bet is still open on a match that
    // started hours ago.
    prisma.bet.findMany({
      where: {
        status: "OPEN",
        selections: { some: { settled: false, game: { startAt: { lt: cutoff }, ...gameSearch } } },
      },
      select: {
        code: true,
        stake: true,
        potentialWin: true,
        createdAt: true,
        user: { select: { username: true } },
        selections: {
          where: { settled: false },
          select: {
            marketName: true,
            outcomeName: true,
            game: {
              select: { id: true, homeName: true, awayName: true, status: true, startAt: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    // The work: every unsettled outcome on a match that has started, so the
    // queue also covers fixtures whose markets are open but which nobody bet on.
    prisma.outcome.findMany({
      where: { settled: false, market: { game: { startAt: { lt: cutoff }, ...gameSearch } } },
      select: {
        name: true,
        market: {
          select: {
            key: true,
            game: {
              select: { id: true, homeName: true, awayName: true, status: true, startAt: true },
            },
          },
        },
      },
      take: 4000,
    }),
  ]);

  const fixtures = new Map<string, Fixture>();
  const touch = (g: {
    id: string;
    homeName: string;
    awayName: string;
    status: string;
    startAt: Date;
  }): Fixture => {
    const found = fixtures.get(g.id);
    if (found) return found;
    const row: Fixture = {
      id: g.id,
      homeName: g.homeName,
      awayName: g.awayName,
      status: g.status,
      startAt: g.startAt,
      picks: 0,
      stake: 0,
      unsettled: 0,
      needs: new Set<Need>(),
    };
    fixtures.set(g.id, row);
    return row;
  };

  for (const bet of bets) {
    for (const sel of bet.selections) {
      const row = touch(sel.game);
      row.picks += 1;
      row.stake += Number(bet.stake);
    }
  }
  for (const o of outcomes) {
    const g = o.market.game;
    if (!g) continue;
    const row = touch(g);
    row.unsettled += 1;
    row.needs.add(needFor(o.market.key, o.name));
  }

  // A fixture that never reached FINISHED needs its result before anything
  // else can settle — that is the admin-created (MANUAL) case, which no feed
  // will ever advance.
  for (const row of fixtures.values()) {
    if (row.status !== "FINISHED") row.needs.add("RESULT");
  }

  const rows = [...fixtures.values()].sort(
    (a, b) => b.picks - a.picks || a.startAt.getTime() - b.startAt.getTime(),
  );
  const waitingBets = bets.length;
  const atStake = bets.reduce((sum, b) => sum + Number(b.stake), 0);
  const withResultMissing = rows.filter((r) => r.needs.has("RESULT")).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Settlement Queue</h2>
          <p className="mt-1 text-xs text-ink3">
            Bets and fixtures that started more than {WAITING_HOURS}h ago and are still not settled.
            Rows with <b className="text-ink2">open picks</b> are holding customer money right now.
          </p>
        </div>
        <form className="flex items-center gap-2" action="/admin/settlement" method="get">
          <input
            className="input w-56"
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Search team…"
          />
          <button className="btn btn-ghost btn-sm" type="submit">Search</button>
          {term && (
            <Link href="/admin/settlement" className="text-xs text-ink3 hover:text-ink">clear</Link>
          )}
        </form>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`rounded-lg px-3 py-1.5 text-xs font-bold ${waitingBets ? "bg-amber-500/15 text-amber-400" : "bg-hover-tint text-ink2"}`}>
          {waitingBets} bet{waitingBets === 1 ? "" : "s"} waiting
        </span>
        <span className="rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
          {rows.length} fixture{rows.length === 1 ? "" : "s"} unfinished
        </span>
        <span className="rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
          {atStake.toFixed(2)} in stakes
        </span>
        {withResultMissing > 0 && (
          <span className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-400">
            {withResultMissing} need the final score
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card mt-4 p-6 text-sm text-ink2">
          {term ? (
            <>Nothing outstanding matching “{term}”.</>
          ) : (
            <>Nothing outstanding — every started match is settled. 🎉</>
          )}
        </div>
      ) : (
        <>
          {/* ── the money ─────────────────────────────────────────────── */}
          {bets.length > 0 && (
            <div className="card mt-4 overflow-x-auto">
              <div className="border-b border-line px-4 py-3 text-sm font-bold">
                Bets waiting on a result
              </div>
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
                    <th className="px-4 py-2 font-bold">Bet</th>
                    <th className="px-4 py-2 font-bold">Customer</th>
                    <th className="px-4 py-2 font-bold">Fixture</th>
                    <th className="px-4 py-2 font-bold">Selection</th>
                    <th className="px-4 py-2 text-right font-bold">Stake</th>
                    <th className="px-4 py-2 text-right font-bold">Pot. win</th>
                    <th className="px-4 py-2 text-right font-bold">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map((b) => {
                    const first = b.selections[0];
                    return (
                      <tr key={b.code} className="border-b border-line/60 last:border-0 hover:bg-hover-tint">
                        <td className="px-4 py-2 font-mono text-xs font-bold text-ink">{b.code}</td>
                        <td className="px-4 py-2 text-xs text-ink2">{b.user?.username ?? "—"}</td>
                        <td className="px-4 py-2 text-xs">
                          {first ? (
                            <Link href={`/admin/games/${first.game.id}`} className="font-semibold text-ink hover:text-brand-text">
                              {first.game.homeName} v {first.game.awayName}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {first && (
                            <span className="ml-2 rounded-full bg-card2 px-2 py-0.5 text-[10px] font-semibold text-ink3">
                              {first.game.status}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink2">
                          {b.selections.map((s) => `${s.marketName} · ${s.outcomeName}`).join(", ")}
                        </td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{Number(b.stake).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{Number(b.potentialWin).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-xs text-ink3">
                          {first ? `${hoursSince(first.game.startAt)}h` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── the work ──────────────────────────────────────────────── */}
          <div className="card mt-4 overflow-x-auto">
            <div className="border-b border-line px-4 py-3 text-sm font-bold">
              Fixtures needing action — oldest money first
            </div>
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
                  <th className="px-4 py-2 font-bold">Fixture</th>
                  <th className="px-4 py-2 font-bold">Kickoff</th>
                  <th className="px-4 py-2 font-bold">Status</th>
                  <th className="px-4 py-2 text-right font-bold">Open picks</th>
                  <th className="px-4 py-2 text-right font-bold">Unsettled</th>
                  <th className="px-4 py-2 font-bold">Needs</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-hover-tint">
                    <td className="px-4 py-2 text-xs font-semibold text-ink">
                      {r.homeName} v {r.awayName}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink2">{formatDateTime(r.startAt)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "FINISHED" ? "bg-card2 text-ink3" : "bg-amber-500/15 text-amber-400"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className={`px-4 py-2 text-right text-xs tabular-nums font-bold ${r.picks ? "text-amber-400" : "text-ink3"}`}>
                      {r.picks}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-ink2">{r.unsettled}</td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap gap-1">
                        {[...r.needs].map((n) => (
                          <span key={n} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${NEED_STYLE[n]}`}>
                            {NEED_LABEL[n]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/admin/games/${r.id}`} className="btn btn-primary btn-sm">
                        Settle →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 60 && (
              <div className="border-t border-line px-4 py-2 text-[11px] text-ink3">
                Showing the 60 with the most money on them — {rows.length - 60} more, search to narrow.
              </div>
            )}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ink3">
            <b className="text-ink2">Half-time score:</b> open the fixture and enter it under{" "}
            <code className="rounded bg-hover-tint px-1">Half-time score</code> — the settle cron clears every
            half-time market on the match within ~12 minutes. <b className="text-ink2">Status not FINISHED:</b> set the
            final score and the status first, otherwise nothing downstream can settle. Never guess a score — it pays
            real money.
          </p>
        </>
      )}
    </div>
  );
}
