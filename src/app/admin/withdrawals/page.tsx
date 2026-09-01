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
const FINAL = ["COMPLETED", "REJECTED", "CANCELLED", "FAILED", "PROCESSING"];

/** Click-to-copy reference badge (PLP-WDR-XXXXXXXX). */
function RefBadge({ ref }: { ref: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy reference code"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(ref);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = ref;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold transition-colors ${
        copied ? "bg-green-500/20 text-green-400" : "bg-brand/10 text-brand hover:bg-brand/20"
      }`}
    >
      {copied ? "✓ copied" : ref}
    </button>
  );
}

export default function AdminWithdrawals() {
  const { push } = useToast();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState("");
  // Single-click approval confirmation modal
  const [confirming, setConfirming] = useState<Withdrawal | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function load() {
    const r = await apiFetch<{ withdrawals: Withdrawal[] }>(`/api/admin/withdrawals${status ? `?status=${status}` : ""}`);
    if (r.ok) setWithdrawals(r.data.withdrawals);
  }

  async function change(w: Withdrawal, action: "approve" | "reject" | "cancel") {
    const url = `/api/admin/withdrawals/${w.id}/${action === "approve" ? "approve" : "reject"}`;
    const body = action === "cancel" ? { status: "CANCELLED" } : action === "reject" ? { status: "REJECTED" } : {};
    const res = await apiFetch(url, { method: "POST", body });
    if (!res.ok) return push("error", res.error.message);
    push(
      "success",
      action === "approve" ? "Approved — marked paid" : action === "reject" ? "Rejected — reservation refunded" : "Cancelled — reservation refunded",
    );
    setConfirming(null);
    load();
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
                  {w.trackingId && <RefBadge ref={w.trackingId} />}
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
                  title="Mark as paid — funds are already reserved; the PLP-WDR reference is the audit trail"
                  disabled={FINAL.includes(w.status)}
                  onClick={() => setConfirming(w)}
                >
                  Approve & mark paid
                </button>
                <button
                  className="btn btn-sm bg-red-600 text-white hover:brightness-110"
                  title="Reject the request and restore the reserved funds to the user's wallet"
                  disabled={FINAL.includes(w.status)}
                  onClick={() => change(w, "reject")}
                >
                  Reject & refund
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Cancel the request and restore the reserved funds to the user's wallet"
                  disabled={FINAL.includes(w.status)}
                  onClick={() => change(w, "cancel")}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Single-click approval confirmation modal */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setConfirming(null)}
        >
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Approve withdrawal?</h3>
            <p className="mt-2 text-sm text-ink2">
              Mark <b>{Number(confirming.amount).toLocaleString()} {confirming.currencyCode}</b> as paid to{" "}
              <b>{confirming.user.username}</b>
              {confirming.trackingId ? (
                <>
                  {" "}· ref <span className="font-mono text-brand">{confirming.trackingId}</span>
                </>
              ) : null}
              ? Funds were reserved at request time — this only finalizes the payout.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setConfirming(null)}>Back</button>
              <button
                className="btn flex-1 bg-green-600 text-white hover:brightness-110"
                onClick={() => change(confirming, "approve")}
              >
                Approve & mark paid
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-ink3">
        Funds are reserved at request time (atomic wallet debit) with an auto-assigned{" "}
        <span className="font-mono">PLP-WDR-*</span> reference. Approve finalizes the payout (single click — the
        reference code is the audit trail). Reject/Cancel refunds the reservation exactly once. All actions are audited.
      </p>
    </div>
  );
}
