"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { formatDateTime } from "@/lib/odds";

type Withdrawal = {
  id: string; amount: string; currencyCode: string; status: string; method: string;
  destination: string; adminNote: string | null; createdAt: string;
  user: { username: string; email: string };
};

const STATUSES = ["PENDING", "VERIFICATION_REQUIRED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED", "FAILED"];

export default function AdminWithdrawals() {
  const { push } = useToast();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function load() {
    const r = await apiFetch<{ withdrawals: Withdrawal[] }>(`/api/admin/withdrawals${status ? `?status=${status}` : ""}`);
    if (r.ok) setWithdrawals(r.data.withdrawals);
  }

  async function change(w: Withdrawal, s: string, note = "") {
    const res = await apiFetch(`/api/admin/withdrawals/${w.id}`, { method: "PATCH", body: { status: s, adminNote: note } });
    if (!res.ok) return push("error", res.error.message);
    push("success", s === "COMPLETED" ? "Completed — user balance debited" : `Withdrawal → ${s.toLowerCase()}`);
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
                </div>
                <div className="truncate text-xs text-ink3">
                  {w.user.username} · {w.user.email} · {formatDateTime(new Date(w.createdAt))}
                </div>
                <div className="truncate font-mono text-xs text-ink3">→ {w.destination}</div>
                {w.adminNote && <div className="text-xs text-amber-400">Note: {w.adminNote}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["COMPLETED", "PROCESSING", "REJECTED", "CANCELLED"].map((s) => (
                  <button
                    key={s}
                    className={`btn btn-sm ${s === "COMPLETED" ? "bg-green-600 text-white hover:brightness-110" : s === "REJECTED" ? "bg-red-600 text-white hover:brightness-110" : "btn-ghost"}`}
                    disabled={["COMPLETED", "REJECTED", "CANCELLED", "FAILED"].includes(w.status)}
                    onClick={() => change(w, s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink3">Completing a withdrawal debits the user&apos;s balance atomically. All actions are audited.</p>
    </div>
  );
}
