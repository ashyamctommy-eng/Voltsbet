"use client";

import { useEffect, useState } from "react";
import { useSiteName } from "@/components/SiteSettingsContext";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useBetSlip } from "@/components/BetSlipContext";
import { useToast } from "@/components/BetSlipContext";
import { BET_CANCEL_WINDOW_MS } from "@/lib/bet-cancel";
import CashOutButton from "@/components/account/CashOutButton";
import { RotateCcw, Share2 } from "lucide-react";

export type DetailSelection = {
  id: string;
  outcomeId: string; // the real Outcome row id — the betslip resolves bets by this
  gameId: string;
  sport: string;
  competition: string;
  home: string;
  away: string;
  startAt: string;
  status: string;
  live: boolean;
  market: string;
  marketKey: string;
  outcome: string;
  label: string | null;
  odds: number;
  result: string | null;
  /** Optional display-only match data; omitted when unavailable. */
  homeScore?: number | null;
  awayScore?: number | null;
  clock?: string | null;
  period?: string | null;
};

/**
 * Action controls for the bet detail page: Cancel (window timer), Share,
 * Rebet (repopulates the betslip with the same selections).
 */
export default function BetActions({
  bet,
  shareUrl,
  showCashOut = true,
}: {
  bet: {
    id: string;
    code: string;
    status: string;
    createdAt: string;
    selections: DetailSelection[];
  };
  shareUrl?: string;
  showCashOut?: boolean;
}) {
  const siteName = useSiteName();
  const router = useRouter();
  const { push } = useToast();
  const { add, setOpen: openSlip } = useBetSlip();
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((new Date(bet.createdAt).getTime() + BET_CANCEL_WINDOW_MS - Date.now()) / 1000)),
  );

  useEffect(() => {
    if (bet.status !== "OPEN" || cancelled || remaining <= 0) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        const next = Math.max(0, r - 1);
        if (next <= 0) clearInterval(t);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [bet.status, cancelled, remaining]);

  const cancellable = bet.status === "OPEN" && !cancelled && remaining > 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  async function cancel() {
    setCancelling(true);
    const res = await apiFetch<{ message: string }>(`/api/account/bets/${bet.id}/cancel`, { method: "POST", body: {} });
    setCancelling(false);
    if (res.ok) {
      setCancelled(true);
      push("success", res.data?.message ?? `Bet ${bet.code} cancelled — stake refunded.`);
      router.refresh();
    } else {
      push("error", res.error.message);
    }
  }

  function share() {
    const text = `${(siteName.trim() || "Sportsbook")} bet ${bet.code}: ${bet.selections.length} selection(s)`;
    const url = shareUrl && typeof window !== "undefined"
      ? new URL(shareUrl, window.location.origin).toString()
      : window.location.href;
    const payload = {
      title: `Bet ${bet.code}`,
      text,
      url,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share(payload).catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(`${text} ${url}`).then(
        () => push("success", "Bet link copied to clipboard."),
        () => push("error", "Could not copy the link."),
      );
    }
  }

  function rebet() {
    let added = 0;
    for (const s of bet.selections) {
      if (!(s.odds > 0)) continue;
      add({
        outcomeId: s.outcomeId,
        gameId: s.gameId,
        sport: s.sport,
        competition: s.competition,
        home: s.home,
        away: s.away,
        startAt: s.startAt,
        market: s.market,
        marketKey: s.marketKey,
        outcome: s.outcome,
        label: s.label ?? "",
        odds: s.odds,
        gameStatus: s.status,
        live: s.live,
      });
      added++;
    }
    if (added === 0) {
      push("error", "None of these selections are available to bet anymore.");
      return;
    }
    openSlip(true);
    push("success", `Rebet ready — ${added} selection(s) added at the original odds.`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {showCashOut && bet.status === "OPEN" && <CashOutButton betId={bet.id} code={bet.code} status={bet.status} />}
      {bet.status === "OPEN" && (
        <button
          onClick={cancel}
          disabled={!cancellable || cancelling}
          className="btn btn-ghost !border-red-500/40 !text-red-400 hover:!bg-red-500/10 disabled:opacity-50"
        >
          {cancelled ? "Cancelled" : cancelling ? "Cancelling…" : `Cancel (${mm}:${ss})`}
        </button>
      )}
      <button
        onClick={share}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
      >
        <Share2 aria-hidden="true" className="h-3.5 w-3.5" />
        Share
      </button>
      <button
        onClick={rebet}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
      >
        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        Rebet
      </button>
    </div>
  );
}
