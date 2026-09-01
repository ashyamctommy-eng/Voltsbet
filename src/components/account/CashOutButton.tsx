"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type CashOutQuote = { available: boolean; value?: number; reason?: string };

/**
 * Cash Out control — used on bet cards (list) and the bet detail page.
 * Flow: click → fetch live quote → show offer → confirm → execute (the
 * server re-quotes at execution, so the credited amount is the live price).
 * Renders nothing for non-OPEN bets.
 */
export default function CashOutButton({
  betId,
  code,
  status,
}: {
  betId: string;
  code: string;
  status: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [quote, setQuote] = useState<CashOutQuote | null>(null);

  if (status !== "OPEN") return null;

  const stop = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function openQuote(e: { preventDefault: () => void; stopPropagation: () => void }) {
    stop(e);
    setBusy(true);
    const res = await apiFetch<CashOutQuote>(`/api/account/bets/${betId}/cashout`);
    setBusy(false);
    if (!res.ok) return push("error", res.error.message);
    setQuote(res.data);
    if (!res.data.available) {
      push("error", res.data.reason ?? "Cash-out is unavailable right now.");
      return;
    }
    setConfirming(true);
  }

  async function confirm(e: { preventDefault: () => void; stopPropagation: () => void }) {
    stop(e);
    setBusy(true);
    const res = await apiFetch<{ value: number }>(`/api/account/bets/${betId}/cashout`, { method: "POST", body: {} });
    setBusy(false);
    if (!res.ok) {
      setConfirming(false);
      return push("error", res.error.message);
    }
    push("success", `Bet ${code} cashed out — ${Number(res.data.value).toLocaleString()} credited.`);
    setConfirming(false);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {confirming && quote?.value != null ? (
        <>
          <button
            onClick={confirm}
            disabled={busy}
            className="rounded-full bg-brand px-3 py-1.5 text-xs font-black text-[#052e16] transition-all hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Cashing out…" : `Cash out ${Number(quote.value).toLocaleString()}?`}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
            className="text-xs text-ink3 hover:text-ink"
            aria-label="Cancel cash-out"
          >
            ✕
          </button>
        </>
      ) : (
        <button
          onClick={openQuote}
          disabled={busy}
          className="rounded-full border border-brand/40 px-3 py-1.5 text-xs font-black text-brand transition-colors hover:bg-brand/10 disabled:opacity-50"
        >
          {busy ? "Quoting…" : "Cash Out"}
        </button>
      )}
    </span>
  );
}
