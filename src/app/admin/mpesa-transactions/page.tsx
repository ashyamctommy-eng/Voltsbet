"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { formatDateTime } from "@/lib/odds";

type Row = {
  kind: "DEPOSIT" | "WITHDRAWAL";
  id: string;
  ref: string;
  user: { username: string; email: string };
  amount: number;
  currencyCode: string;
  provider: string;
  status: string;
  createdAt: string;
};

type Summary = {
  stkPushes: number;
  b2cPayouts: number;
  credited: Record<string, number>;
  paidOut: Record<string, number>;
  pendingPayouts: number;
};

const STATUS_TONE: Record<string, string> = {
  // deposits
  AWAITING_PAYMENT: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  PAYMENT_DETECTED: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  CONFIRMING: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  CONFIRMED: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  COMPLETED: "bg-green-500/15 text-green-600 dark:text-green-300",
  EXPIRED: "bg-gray-500/15 text-gray-500 dark:text-gray-400",
  FAILED: "bg-red-500/15 text-red-600 dark:text-red-300",
  CANCELLED: "bg-gray-500/15 text-gray-500 dark:text-gray-400",
  // withdrawals
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  VERIFICATION_REQUIRED: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  PROCESSING: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  REJECTED: "bg-red-500/15 text-red-600 dark:text-red-300",
  CANCELLED_BY_USER: "bg-gray-500/15 text-gray-500 dark:text-gray-400",
};

function Pill({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[status] ?? "bg-card2 text-ink2"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function AdminMpesaTransactions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ rows: Row[]; summary: Summary }>("/api/admin/mpesa-transactions").then((r) => {
      if (r.ok) {
        setRows(r.data.rows);
        setSummary(r.data.summary);
      } else setError(r.error.message);
    });
  }, []);

  const money = (n: number, code: string) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + code;
  const sumEntries = (m: Record<string, number> | undefined) => Object.entries(m ?? {});

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold">M-Pesa Transactions</h2>
        <p className="mt-1 text-sm text-ink2">
          Track STK push logs, C2B/B2C payments, and manual transaction reconciliations
        </p>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">STK pushes</div>
          <div className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{summary?.stkPushes ?? "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">B2C payouts</div>
          <div className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{summary?.b2cPayouts ?? "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Pending payouts</div>
          <div className="mt-1 text-xl font-extrabold text-amber-600 dark:text-amber-400">{summary?.pendingPayouts ?? "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Completed (last 100)</div>
          <div className="mt-1 space-y-0.5 text-sm font-bold text-slate-900 dark:text-white">
            {!summary ? (
              "—"
            ) : (
              <>
                {sumEntries(summary.credited).map(([code, n]) => (
                  <div key={"c" + code} className="text-green-600 dark:text-green-400">+{money(n, code)}</div>
                ))}
                {sumEntries(summary.paidOut).map(([code, n]) => (
                  <div key={"p" + code} className="text-red-600 dark:text-red-400">−{money(n, code)}</div>
                ))}
                {sumEntries(summary.credited).length + sumEntries(summary.paidOut).length === 0 && <div className="text-xs font-medium text-ink3">none yet</div>}
              </>
            )}
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {/* Transaction log */}
      <div className="card w-full max-w-full overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!rows && !error && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-ink3">Loading…</td>
                </tr>
              )}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-ink3">No M-Pesa transactions yet.</td>
                </tr>
              )}
              {rows?.map((r) => (
                <tr key={r.kind + r.id} className="transition-colors hover:bg-hover-tint">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-ink">{r.ref}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                      r.kind === "DEPOSIT" ? "bg-brand/15 text-green-600 dark:text-green-300" : "bg-card2 text-slate-600 dark:text-slate-300"
                    }`}>
                      {r.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{r.user.username}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.user.email}</div>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-bold ${r.kind === "DEPOSIT" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {r.kind === "DEPOSIT" ? "+" : "−"}{money(r.amount, r.currencyCode)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-ink2">{r.provider}</td>
                  <td className="px-4 py-2.5"><Pill status={r.status} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {formatDateTime(new Date(r.createdAt), { date: true, time: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
