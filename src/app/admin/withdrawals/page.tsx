"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { formatDateTime } from "@/lib/odds";

type Withdrawal = {
  id: string; trackingId: string | null; amount: string; currencyCode: string; status: string; method: string;
  destination: string; adminNote: string | null; createdAt: string;
  user: { username: string; email: string };
};

const STATUSES = ["PENDING", "VERIFICATION_REQUIRED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED", "FAILED"];

export default function AdminWithdrawals() {
  const { push } = useToast();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState("");
  // Manual-approval attestation: which row is collecting a payout ref/note
  const [attesting, setAttesting] = useState<string | null>(null);
  const [payoutRef, setPayoutRef] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function load() {
    const r = await apiFetch<{ withdrawals: Withdrawal[] }>(`/api/admin/withdrawals${status ? `?status=${status}` : ""}`);
    if (r.ok) setWithdrawals(r.data.withdrawals);
  }

  async function change(w: Withdrawal, s: string, extra: { adminNote?: string; payoutRef?: string } = {}) {
    const res = await apiFetch(`/api/admin/withdrawals/${w.id}`, { method: "PATCH", body: { status: s, ...extra } });
    if (!res.ok) return push("error", res.error.message);
    push("success", s === "COMPLETED" ? "Approved — marked paid" : s === "REJECTED" ? "Rejected — reservation refunded" : `Withdrawal → ${s.toLowerCase()}`);
    setAttesting(null);
    setPayoutRef("");
    setNote("");
    load();
  }

  /** COMPLETED needs a manual payout attestation (receipt/note). */
  function approve(w: Withdrawal) {
    if (attesting === w.id) {
      if (!payoutRef.trim() && !note.trim()) {
        return push("error", "Enter the payout reference (tx hash / payment code) or a note describing the manual payout.");
      }
      return change(w, "COMPLETED", { payoutRef: payoutRef.trim(), adminNote: note.trim() });
    }
    setAttesting(w.id);
    setPayoutRef("");
    setNote("");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Withdrawals</h2>
        <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="card divide-y divide-line">
        {withdrawals.length === 0 && <div className="p-8 text-center text-sm text-ink3">No withdrawals.</div>}
        {withdrawals.map((w) => (
          <div key={w.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {Number(w.amount).toLocaleString()} {w.currencyCode}
                  <span className="ml-2 rounded bg-card2 px-1.5 py-0.5 text-[10px] font-bold text-ink2">{w.method}</span>
                  {w.trackingId && (
                    <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand">{w.trackingId}</span>
                  )}
                </div>
                <div className="truncate text-xs text-ink3">
                  {w.user.username} · {w.user.email} · {formatDateTime(new Date(w.createdAt))}
                </div>
                <div className="truncate font-mono text-xs text-ink3">→ {w.destination}</div>
                {w.adminNote && <div className="text-xs text-amber-400">Note: {w.adminNote}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="btn btn-sm bg-green-600 text-white hover:brightness-110"
                  title="Mark as paid — requires a payout reference (tx hash / payment code) or an admin note"
                  disabled={["COMPLETED", "REJECTED", "CANCELLED", "FAILED", "PROCESSING"].includes(w.status)}
                  onClick={() => approve(w)}
                >
                  {attesting === w.id ? "Confirm paid" : "Approve & mark paid"}
                </button>
                <button
                  className="btn btn-sm bg-red-600 text-white hover:brightness-110"
                  title="Reject the request and restore the reserved funds to the user's wallet"
                  disabled={["COMPLETED", "REJECTED", "CANCELLED", "FAILED", "PROCESSING"].includes(w.status)}
                  onClick={() => change(w, "REJECTED")}
                >
                  Reject & refund
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Cancel the request and restore the reserved funds to the user's wallet"
                  disabled={["COMPLETED", "REJECTED", "CANCELLED", "FAILED", "PROCESSING"].includes(w.status)}
                  onClick={() => change(w, "CANCELLED")}
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Manual payout attestation form */}
            {attesting === w.id && (
              <div className="mt-3 space-y-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
                <p className="text-xs text-ink2">
                  Funds are already reserved. Record how you paid <b>{w.user.username}</b> {Number(w.amount).toLocaleString()} {w.currencyCode}:
                </p>
                <input
                  className="input font-mono text-xs"
                  placeholder="Payout reference — tx hash / M-Pesa code / bank ref"
                  value={payoutRef}
                  onChange={(e) => setPayoutRef(e.target.value)}
                />
                <input
                  className="input text-xs"
                  placeholder="Or an admin note describing the manual payout"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => setAttesting(null)}>Back</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink3">
        Funds are reserved at request time (atomic wallet debit). Approving requires a payout reference (tx hash / payment
        code) or an admin note attesting the external transfer. Reject/Cancel refunds the reservation exactly once. All
        actions are audited.
      </p>
    </div>
  );
}
