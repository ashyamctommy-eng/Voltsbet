"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconCoins, IconSmartphone } from "@/components/icons";

type PendingDeposit = {
  id: string;
  status: string;
  paymentAddress?: string;
  cryptoCurrency?: string;
  amount?: string;
};

const POLL_MS = 5000;
const FINAL_STATUSES = ["COMPLETED", "EXPIRED", "FAILED", "CANCELLED"];

/** Quick deposit modal — opened from the header wallet button. Reuses the same
 *  APIs as /account/deposit (POST /api/account + demo webhook + status poll). */
export default function DepositModal({ onClose }: { onClose: () => void }) {
  const { push } = useToast();
  const [method, setMethod] = useState<"CRYPTO" | "MPESA">("CRYPTO");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<PendingDeposit | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const amountNum = parseFloat(amount);
  const valid = amountNum > 0 && (method === "CRYPTO" || phone.trim().length >= 9);

  // Real-time status polling: while a deposit is pending, poll every 5s so
  // the moment the webhook confirms payment the modal reflects it (and the
  // wallet credit lands) without the user closing and reopening anything.
  useEffect(() => {
    if (!pending || FINAL_STATUSES.includes(pending.status)) return;
    let alive = true;
    let stopped = false; // a terminal status arrived via a poll response
    const tick = async () => {
      if (stopped) return;
      const res = await apiFetch<{ deposit: PendingDeposit }>(`/api/account/deposits/${pending.id}`);
      if (!alive || !res.ok) return;
      const d = res.data.deposit;
      if (d.status === "COMPLETED") {
        setPending(null);
        setAmount("");
        setPhone("");
        push("success", "Payment confirmed! Balance credited.");
        onClose();
        return;
      }
      if (FINAL_STATUSES.includes(d.status)) {
        stopped = true;
        setPending(d);
        push("error", `Deposit ${d.status.toLowerCase()} — no funds were credited.`);
        return;
      }
      setPending((p) => (p ? { ...p, status: d.status } : p));
    };
    const t = setInterval(tick, POLL_MS);
    void tick(); // first check immediately
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id]);

  async function createDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    const res = await apiFetch<{ deposit: PendingDeposit }>("/api/account", {
      method: "POST",
      body:
        method === "MPESA"
          ? { amount: amountNum, method: "MPESA", phone }
          : { amount: amountNum, method: "CRYPTO", cryptoCurrency: "USDT" },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    setPending(res.data.deposit);
    push("success", method === "MPESA" ? "STK push sent — check your phone." : "Payment created — send the crypto to the address shown.");
  }

  async function simulateConfirm() {
    if (!pending) return;
    setLoading(true);
    const res = await apiFetch("/api/webhooks/crypto/demo", {
      method: "POST",
      body: { deposit_id: pending.id, tx_hash: `demo-${Date.now().toString(16)}` },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Payment confirmed! Balance credited.");
    setPending(null);
    setAmount("");
    setPhone("");
    onClose();
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(pending?.paymentAddress ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push("info", "Copy the address manually.");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Deposit">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="sheet-up relative w-full max-w-md rounded-t-2xl border border-line bg-panel-bg p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">Deposit</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        {!pending ? (
          <form onSubmit={createDeposit} className="mt-4 space-y-4">
            {/* Method tabs */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod("CRYPTO")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${
                  method === "CRYPTO" ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink2"
                }`}
              >
                <IconCoins className="h-4 w-4" /> Crypto
              </button>
              <button
                type="button"
                onClick={() => setMethod("MPESA")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${
                  method === "MPESA" ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink2"
                }`}
              >
                <IconSmartphone className="h-4 w-4" /> M-Pesa
              </button>
            </div>

            <div>
              <label className="label">Amount</label>
              <input className="input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>

            {method === "MPESA" && (
              <div>
                <label className="label">M-Pesa phone number</label>
                <input className="input" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            )}

            <button className="btn btn-primary w-full !py-3" disabled={!valid || loading}>
              {loading ? "Creating…" : `Deposit ${valid ? amount : ""}`}
            </button>
          </form>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Live status strip */}
            <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-card2 px-3 py-2 text-xs font-semibold">
              <span className={`live-dot ${FINAL_STATUSES.includes(pending.status) ? "!bg-amber-400" : ""}`} />
              <span className="text-ink2">
                {FINAL_STATUSES.includes(pending.status)
                  ? `Deposit ${pending.status.toLowerCase()}`
                  : `Status: ${pending.status.replace(/_/g, " ").toLowerCase()} — checking automatically…`}
              </span>
            </div>
            <div className="rounded-xl border border-line bg-card p-4 text-center">
              <div className="text-xs text-ink3">Send {pending.cryptoCurrency ?? "USDT"} to this address</div>
              <div className="mt-2 break-all rounded-lg bg-black/30 p-3 font-mono text-[11px] text-brand">
                {pending.paymentAddress ?? "generating…"}
              </div>
              <button type="button" onClick={copyAddress} className="btn btn-ghost btn-sm mt-3">
                {copied ? "Copied ✓" : "Copy address"}
              </button>
            </div>
            <button type="button" onClick={simulateConfirm} disabled={loading} className="btn btn-ghost w-full">
              {loading ? "Confirming…" : "Simulate payment (demo)"}
            </button>
            <p className="text-center text-[11px] text-ink3">Real payments credit automatically — this window updates live.</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
