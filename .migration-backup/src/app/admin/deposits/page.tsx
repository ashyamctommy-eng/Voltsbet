"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { formatDateTime } from "@/lib/odds";

type Deposit = {
  id: string; amount: string; currencyCode: string; status: string; cryptoCurrency: string | null;
  network: string | null; paymentAddress: string | null; txHash: string | null;
  createdAt: string; expiresAt: string | null; user: { username: string; email: string };
};

type Summary = { byStatus: Record<string, number>; stale: number; expiredLast7d: number };

const STATUSES = ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING", "CONFIRMED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED"];

export default function AdminDeposits() {
  const { push } = useToast();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function load() {
    const r = await apiFetch<{ deposits: Deposit[]; summary: Summary }>(`/api/admin/deposits${status ? `?status=${status}` : ""}`);
    if (r.ok) {
      setDeposits(r.data.deposits);
      setSummary(r.data.summary);
    }
  }

  async function change(d: Deposit, s: string) {
    if (s === d.status) return;
    const res = await apiFetch(`/api/admin/deposits/${d.id}`, { method: "PATCH", body: { status: s } });
    if (!res.ok) return push("error", res.error.message);
    push("success", `Deposit ${s === "COMPLETED" ? "completed — balance credited" : `→ ${s.toLowerCase()}`}`);
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Crypto Deposits</h2>
        <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="STALE">⚠ Stale (past expiry, unswept)</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Expiry reconciliation surface */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setStatus("STALE")}
            className={`card p-4 text-left transition-colors hover:border-amber-400/50 ${summary.stale > 0 ? "border-amber-400/40" : ""}`}
          >
            <div className={`text-2xl font-black ${summary.stale > 0 ? "text-amber-400" : "text-ink"}`}>{summary.stale}</div>
            <div className="text-xs text-ink3">Stale past expiry</div>
            <div className="text-[10px] text-ink3">Creditable but window closed — reconcile or let purge sweep</div>
          </button>
          <button type="button" onClick={() => setStatus("EXPIRED")} className="card p-4 text-left transition-colors hover:border-line2">
            <div className="text-2xl font-black">{summary.expiredLast7d}</div>
            <div className="text-xs text-ink3">Expired (7d)</div>
            <div className="text-[10px] text-ink3">Auto-expired by the purge cron</div>
          </button>
          <button type="button" onClick={() => setStatus("COMPLETED")} className="card p-4 text-left transition-colors hover:border-line2">
            <div className="text-2xl font-black text-green-400">{summary.byStatus["COMPLETED"] ?? 0}</div>
            <div className="text-xs text-ink3">Completed</div>
          </button>
          <button type="button" onClick={() => setStatus("AWAITING_PAYMENT")} className="card p-4 text-left transition-colors hover:border-line2">
            <div className="text-2xl font-black">{summary.byStatus["AWAITING_PAYMENT"] ?? 0}</div>
            <div className="text-xs text-ink3">Awaiting payment</div>
          </button>
        </div>
      )}

      <div className="card divide-y divide-line">
        {deposits.length === 0 && <div className="p-8 text-center text-sm text-ink3">No deposits.</div>}
        {deposits.map((d) => (
          <div key={d.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {Number(d.amount).toLocaleString()} {d.currencyCode}
                  <span className="ml-2 rounded bg-card2 px-1.5 py-0.5 text-[10px] font-bold text-ink2">{d.cryptoCurrency ?? "—"}</span>
                </div>
                <div className="truncate text-xs text-ink3">
                  {d.user.username} · {d.user.email} · {formatDateTime(new Date(d.createdAt))}
                  {d.txHash && <span className="ml-2 font-mono">tx {d.txHash.slice(0, 14)}…</span>}
                  {d.expiresAt && !["COMPLETED", "EXPIRED", "FAILED", "CANCELLED"].includes(d.status) && (
                    <span className={`ml-2 ${new Date(d.expiresAt) < new Date() ? "font-bold text-amber-400" : ""}`}>
                      {new Date(d.expiresAt) < new Date() ? "⚠ expired window" : `expires ${formatDateTime(new Date(d.expiresAt))}`}
                    </span>
                  )}
                </div>
              </div>
              <select className="input w-44 py-1.5 text-xs" value={d.status} onChange={(e) => change(d, e.target.value)}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
