"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type VoucherRow = {
  id: string;
  displayCode: string;
  codeLast4: string;
  value: number;
  currency: string;
  status: string;
  batchName: string | null;
  expiresAt: string | null;
  createdAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
  transactionId: string | null;
};

type ListResponse = {
  vouchers: VoucherRow[];
  total: number;
  totalPages: number;
  page: number;
  stats: Record<string, number>;
};

type Stats = {
  total: { count: number; value: number };
  unused: number;
  redeemed: number;
  redeemedValue: number;
  expired: number;
  cancelled: number;
  suspended: number;
  todayRedemptions: number;
  monthRedemptions: number;
  last30Days: { date: string; count: number; value: number }[];
};

const STATUS_BADGE: Record<string, string> = {
  UNUSED: "bg-brand/15 text-brand",
  REDEEMED: "bg-green-500/15 text-green-400",
  EXPIRED: "bg-hover-tint text-ink3",
  CANCELLED: "bg-red-500/15 text-red-400",
  SUSPENDED: "bg-amber-500/15 text-amber-400",
};
const STATUSES = ["ALL", "UNUSED", "REDEEMED", "EXPIRED", "CANCELLED", "SUSPENDED"];

export default function AdminVouchers() {
  const { push } = useToast();
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [listStats, setListStats] = useState<Record<string, number>>({}); // per-status counts for the current filter
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState("ALL");
  const [currency, setCurrency] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [batchId, setBatchId] = useState("");
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string | null; currency: string; value: number }[]>([]);
  const [showGen, setShowGen] = useState(false);
  const [gen, setGen] = useState({ currency: "", value: "", quantity: "10", prefix: "TTB", batchName: "", notes: "", expiresAt: "" });
  const [generating, setGenerating] = useState(false);
  const [lastGen, setLastGen] = useState<{ batchId: string; count: number; codes: string[] } | null>(null);

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(page), limit: "20" });
    if (status !== "ALL") sp.set("status", status);
    if (currency) sp.set("currency", currency);
    if (q) sp.set("q", q);
    if (batchId) sp.set("batch", batchId);
    const res = await apiFetch<ListResponse>(`/api/admin/vouchers?${sp.toString()}`);
    if (!res.ok) return push("error", res.error.message);
    setRows(res.data.vouchers);
    setTotal(res.data.total);
    setTotalPages(res.data.totalPages);
    setListStats(res.data.stats);
  }, [page, status, currency, q, batchId, push]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    apiFetch<{ stats: Stats }>("/api/admin/vouchers/stats").then((r) => r.ok && setStats(r.data.stats));
    apiFetch<{ currencies: { code: string }[] }>("/api/public/currencies").then((r) => r.ok && setCurrencies(r.data.currencies.map((c) => c.code)));
    apiFetch<{ batches: { id: string; name: string | null; currency: string; value: number }[] }>("/api/admin/voucher-batches").then((r) => r.ok && setBatches(r.data.batches));
  }, []);

  const statCards = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "Total Vouchers", value: stats.total.count.toLocaleString(), sub: `value ${stats.total.value.toLocaleString()}` },
      { label: "Unused", value: stats.unused.toLocaleString(), sub: "available" },
      { label: "Redeemed", value: stats.redeemed.toLocaleString(), sub: `value ${stats.redeemedValue.toLocaleString()}` },
      { label: "Expired", value: stats.expired.toLocaleString() },
      { label: "Cancelled", value: stats.cancelled.toLocaleString() },
      { label: "Suspended", value: stats.suspended.toLocaleString() },
      { label: "Today's Redemptions", value: stats.todayRedemptions.toLocaleString() },
      { label: "This Month", value: stats.monthRedemptions.toLocaleString(), sub: "redemptions" },
    ];
  }, [stats]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    const res = await apiFetch<{ batchId: string; count: number; prefix: string; codes: string[] }>(
      "/api/admin/vouchers/generate",
      {
        method: "POST",
        body: {
          currency: gen.currency,
          value: Number(gen.value),
          quantity: Number(gen.quantity),
          expiresAt: gen.expiresAt ? new Date(gen.expiresAt).toISOString() : null,
          prefix: gen.prefix,
          batchName: gen.batchName,
          notes: gen.notes,
        },
      },
    );
    setGenerating(false);
    if (!res.ok) return push("error", res.error.message);
    setLastGen({ batchId: res.data.batchId, count: res.data.count, codes: res.data.codes });
    // Stash the one-shot codes for the print page (session-scoped; full codes
    // are never stored server-side, so printing only works from this session).
    try {
      sessionStorage.setItem(`vb_voucher_codes_${res.data.batchId}`, JSON.stringify(res.data.codes));
    } catch { /* storage unavailable — CSV download still works */ }
    push("success", `${res.data.count} voucher${res.data.count === 1 ? "" : "s"} generated. Full codes shown once — download/print now.`);
    setShowGen(false);
    setPage(1);
    void load();
    apiFetch<{ stats: Stats }>("/api/admin/vouchers/stats").then((r) => r.ok && setStats(r.data.stats));
  }

  function downloadCodes() {
    if (!lastGen) return;
    const csv = "\uFEFF" + ["code,value,currency,expiry,batch,status"].concat(
      lastGen.codes.map((c) => `${c},${gen.value},${gen.currency},${gen.expiresAt || ""},${gen.batchName || ""},UNUSED`),
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vouchers-${lastGen.batchId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportAll() {
    const url = `/api/admin/vouchers/export?status=${status !== "ALL" ? status : ""}${batchId ? `&batchId=${batchId}` : ""}`;
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return push("error", j?.error?.message ?? "Export failed (super admin only).");
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vouchers.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const maxDay = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 365);
    return d.toISOString().slice(0, 10);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold">Vouchers</h1>
          <p className="text-sm text-ink3">Pre-paid deposit codes — redeemable in the player&apos;s Wallet → Deposit → Voucher.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={exportAll} title="Export CSV of the current filter (super admin)">
            Export CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowGen((v) => !v)}>
            {showGen ? "Close" : "+ Generate vouchers"}
          </button>
        </div>
      </div>

      {/* Generate form */}
      {showGen && (
        <form onSubmit={generate} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-bold text-ink2">
            Currency *
            <select className="input mt-1 w-full" value={gen.currency} onChange={(e) => setGen({ ...gen, currency: e.target.value })} required>
              <option value="">— select —</option>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-ink2">
            Value *
            <input className="input mt-1 w-full" type="number" min="1" step="0.01" value={gen.value} onChange={(e) => setGen({ ...gen, value: e.target.value })} required />
          </label>
          <label className="block text-xs font-bold text-ink2">
            Quantity *
            <input className="input mt-1 w-full" type="number" min="1" max="10000" value={gen.quantity} onChange={(e) => setGen({ ...gen, quantity: e.target.value })} required />
          </label>
          <label className="block text-xs font-bold text-ink2">
            Expiry
            <input className="input mt-1 w-full" type="date" min={new Date().toISOString().slice(0, 10)} max={maxDay} value={gen.expiresAt} onChange={(e) => setGen({ ...gen, expiresAt: e.target.value })} />
          </label>
          <label className="block text-xs font-bold text-ink2">
            Prefix
            <input className="input mt-1 w-full" value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value.toUpperCase() })} placeholder="TTB" maxLength={8} />
          </label>
          <label className="block text-xs font-bold text-ink2">
            Batch / campaign name
            <input className="input mt-1 w-full" value={gen.batchName} onChange={(e) => setGen({ ...gen, batchName: e.target.value })} placeholder="Christmas 2026" />
          </label>
          <label className="block text-xs font-bold text-ink2 sm:col-span-2">
            Notes
            <input className="input mt-1 w-full" value={gen.notes} onChange={(e) => setGen({ ...gen, notes: e.target.value })} />
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <button className="btn btn-primary" disabled={generating || !gen.currency || !Number(gen.value)}>
              {generating ? "Generating…" : "Generate vouchers"}
            </button>
          </div>
          <p className="text-[11px] text-ink3 sm:col-span-2 lg:col-span-4">
            Codes are cryptographically random (e.g. {gen.prefix || "TTB"}-XXXX-XXXX-XXXX), stored only as hashes, and shown in full exactly once.
          </p>
        </form>
      )}

      {/* One-shot full-code download after generation */}
      {lastGen && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-sm">
            <span className="font-bold">Batch {lastGen.batchId} — {lastGen.count} codes generated.</span>
            <span className="ml-2 text-ink2">Full codes are shown only now. Download or print them.</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary btn-sm" onClick={downloadCodes}>Download CSV</button>
            <Link className="btn btn-ghost btn-sm" href={`/admin/vouchers/print?batchId=${lastGen.batchId}&value=${gen.value}&currency=${gen.currency}`} target="_blank">
              Print sheets
            </Link>
          </div>
        </div>
      )}

      {/* Stats */}
      {statCards.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {statCards.map((c) => (
            <div key={c.label} className="card p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{c.label}</div>
              <div className="mt-1 text-lg font-extrabold tabular-nums">{c.value}</div>
              {c.sub && <div className="text-[10px] text-ink3">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* 30-day usage (simple bars) */}
      {stats && stats.last30Days.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink3">Redemptions — last 30 days</div>
          <div className="flex h-16 items-end gap-0.5">
            {stats.last30Days.map((d) => (
              <div key={d.date} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-brand/60 transition-colors hover:bg-brand"
                  style={{ height: `${Math.max(4, (d.count / Math.max(1, ...stats.last30Days.map((x) => x.count))) * 64)}px` }}
                  title={`${d.date}: ${d.count} redeemed (${d.value.toLocaleString()})`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-56"
          placeholder="Search voucher (code, last 4, batch)"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setQ(qInput.trim()); setPage(1); } }}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => { setQ(qInput.trim()); setPage(1); }}>Search</button>
        <select className="input w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "All statuses" : s}</option>)}
        </select>
        <select className="input w-28" value={currency} onChange={(e) => { setCurrency(e.target.value); setPage(1); }}>
          <option value="">All cur.</option>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-44" value={batchId} onChange={(e) => { setBatchId(e.target.value); setPage(1); }}>
          <option value="">All batches</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.id.slice(-6)} ({b.currency} {b.value})</option>)}
        </select>
        <span className="ml-auto text-[11px] font-semibold text-ink3">
          {total} vouchers{Object.keys(listStats).length ? ` · ${Object.entries(listStats).map(([k, v]) => `${k} ${v}`).join(" · ")}` : ""}
        </span>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink3">
              <th className="px-4 py-2.5">Voucher</th>
              <th className="px-4 py-2.5">Value</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Batch</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5">Redeemed By</th>
              <th className="px-4 py-2.5">Redeemed At</th>
              <th className="px-4 py-2.5">Expiry</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-line/50 hover:bg-hover-tint/40">
                <td className="px-4 py-2.5 font-mono text-xs">{v.displayCode}</td>
                <td className="px-4 py-2.5 font-semibold tabular-nums">{v.value.toLocaleString()} {v.currency}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_BADGE[v.status] ?? "bg-hover-tint text-ink3"}`}>{v.status}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-ink2">{v.batchName ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-ink2">{new Date(v.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-xs text-ink2">{v.redeemedBy ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-ink2">{v.redeemedAt ? new Date(v.redeemedAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-ink2">{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/admin/vouchers/${v.id}`} className="text-xs font-bold text-brand hover:underline">Details</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-ink3">No vouchers match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          <button className="h-8 rounded-lg bg-card px-3 text-xs font-bold disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .reduce<(number | "…")[]>((acc, p, i, arr) => {
              if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === "…" ? <span key={`e${i}`} className="px-1 text-xs text-ink3">…</span> : (
                <button key={p} onClick={() => setPage(p)} className={`h-8 min-w-8 rounded-lg px-2 text-xs font-bold ${p === page ? "bg-brand text-[#052e16]" : "bg-card"}`}>{p}</button>
              ),
            )}
          <button className="h-8 rounded-lg bg-card px-3 text-xs font-bold disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
