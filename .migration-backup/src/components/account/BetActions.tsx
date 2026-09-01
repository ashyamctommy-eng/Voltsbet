"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useBetSlip } from "@/components/BetSlipContext";
import { useToast } from "@/components/BetSlipContext";
import { BET_CANCEL_WINDOW_MS } from "@/lib/bet-cancel";
import CashOutButton from "@/components/account/CashOutButton";

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
};

/**
 * Action controls for the bet detail page: Cancel (window timer), Share,
 * Rebet (repopulates the betslip with the same selections).
 */
export default function BetActions({
  bet,
}: {
  bet: {
    id: string;
    code: string;
    status: string;
    createdAt: string;
    selections: DetailSelection[];
  };
}) {
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
    const text = `UNIBET360 bet ${bet.code}: ${bet.selections.length} selection(s)`;
    const payload = {
      title: `Bet ${bet.code}`,
      text,
      url: window.location.href,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share(payload).catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(`${text} ${window.location.href}`).then(
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
      {bet.status === "OPEN" && <CashOutButton betId={bet.id} code={bet.code} status={bet.status} />}
      {bet.status === "OPEN" && (
        <button
          onClick={cancel}
          disabled={!cancellable || cancelling}
          className="btn btn-ghost !border-red-500/40 !text-red-400 hover:!bg-red-500/10 disabled:opacity-50"
        >
          {cancelled ? "Cancelled" : cancelling ? "Cancelling…" : `Cancel (${mm}:${ss})`}
        </button>
      )}
      <button onClick={share} className="btn btn-ghost">
        Share
      </button>
      <button onClick={rebet} className="btn btn-primary">
        Rebet
      </button>
    </div>
  );
}
