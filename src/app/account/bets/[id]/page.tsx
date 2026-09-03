import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/odds";
import { resources } from "@/lib/i18n-resources";
import { IconArrowLeft } from "@/components/icons";
import BetActions, { type DetailSelection } from "@/components/account/BetActions";
import BetSelections from "@/components/account/BetSelections";


/** Minimal server-side dictionary read (locale packs live in i18n-resources).
 *  Falls back to English when the user's language lacks the key. */
type Dict = Record<string, string>;
const DICTS = resources as unknown as Record<string, { translation: Dict }>;
function serverT(lang: string, key: string, params?: Record<string, string | number>): string {
  const pack = (DICTS[lang] ?? DICTS.en).translation;
  let out = pack[key] ?? DICTS.en.translation[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) out = out.replace(`{{${k}}}`, String(v));
  return out;
}

export const dynamic = "force-dynamic";

export default async function BetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/bets");
  const L = user.languageCode ?? "en";

  const bet = await prisma.bet.findFirst({
    where: { id, userId: user.id },
    include: {
      selections: {
        include: {
          game: { include: { sport: true } },
          market: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!bet) notFound();

  const selections: DetailSelection[] = bet.selections.map((s) => ({
    id: s.id,
    outcomeId: s.outcomeId,
    gameId: s.gameId,
    sport: s.game.sport.name,
    competition: s.game.competitionName ?? "",
    home: s.game.homeName,
    away: s.game.awayName,
    startAt: s.game.startAt.toISOString(),
    status: s.game.status,
    live: s.game.live,
    market: s.marketName,
    marketKey: s.market.key,
    outcome: s.outcomeName,
    label: s.label,
    odds: Number(s.oddsAtPlacement),
    result: s.result,
  }));

  const settledCount = bet.selections.filter((s) => s.settled).length;
  const total = bet.selections.length;
  const won = bet.selections.filter((s) => s.result === "WON").length;
  const lost = bet.selections.filter((s) => s.result === "LOST").length;
  const tied = bet.selections.filter((s) => s.result === "VOID").length;

  return (
    <div className="space-y-4">
      {/* Header bar: back + BetID */}
      <div className="flex items-center gap-2">
        <Link
          href="/account/bets"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink2 transition-colors hover:text-ink"
          aria-label={serverT(L, "bet.backToBets")}
        >
          <IconArrowLeft className="h-4 w-4" />
        </Link>
        <h2 className="text-lg font-bold">{serverT(L, "bet.betIdLabel")}: {bet.code}</h2>
      </div>

      {/* Summary card */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink3">{serverT(L, "bet.betIdLabel")}</div>
            <div className="text-base font-extrabold">#{bet.code}</div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${
              bet.status === "OPEN"
                ? "bg-brand/15 text-brand"
                : bet.status === "WON"
                  ? "bg-green-500/15 text-green-400"
                  : bet.status === "LOST"
                    ? "bg-red-500/15 text-red-400"
                    : bet.status === "CASHED_OUT"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-hover-tint text-ink3"
            }`}
          >
            {bet.status} ({settledCount}/{total})
          </span>
        </div>
        <div className="mt-2 text-xs text-ink3">{serverT(L, "bet.placedAt", { date: formatDateTime(bet.createdAt) })}</div>
      </div>

      {/* Metrics grid: Amount · Possible Payout · W/L/T */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="card p-3.5 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{serverT(L, "bet.amount")}</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums">{Number(bet.stake).toLocaleString()}</div>
        </div>
        <div className="card p-3.5 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{serverT(L, "bet.possiblePayout")}</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-green-400">
            {Number(bet.potentialWin).toLocaleString()}
          </div>
        </div>
        <div className="card flex items-center justify-around p-3.5">
          <div className="text-center">
            <div className="text-lg font-extrabold tabular-nums text-green-400">{won}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{serverT(L, "bet.w")}</div>
          </div>
          <div className="h-8 w-px bg-line" />
          <div className="text-center">
            <div className="text-lg font-extrabold tabular-nums text-red-400">{lost}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{serverT(L, "bet.l")}</div>
          </div>
          <div className="h-8 w-px bg-line" />
          <div className="text-center">
            <div className="text-lg font-extrabold tabular-nums text-ink2">{tied}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{serverT(L, "bet.t")}</div>
          </div>
        </div>
      </div>

      {/* Action buttons: Cancel (timer) · Share · Rebet */}
      <BetActions bet={{ id: bet.id, code: bet.code, status: bet.status, createdAt: bet.createdAt.toISOString(), selections }} />

      {/* Single selection cards */}
      <BetSelections selections={selections} />
    </div>
  );
}
