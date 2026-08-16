"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { formatDateTime } from "@/lib/odds";

type Deposit = {
  id: string; amount: string; currencyCode: string; status: string; cryptoCurrency: string | null;
  network: string | null; paymentAddress: string | null; txHash: string | null;
  createdAt: string; user: { username: string; email: string };
};

const STATUSES = ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING", "CONFIRMED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED"];

export default function AdminDeposits() {
  const { push } = useToast();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function load() {
    const r = await apiFetch<{ deposits: Deposit[] }>(`/api/admin/deposits${status ? `?status=${status}` : ""}`);
    if (r.ok) setDeposits(r.data.deposits);
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
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

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
