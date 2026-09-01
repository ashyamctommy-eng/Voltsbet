"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/client";

type BatchDetail = {
  batch: { id: string; name: string | null; currency: string; value: number; quantity: number; prefix: string | null; notes: string | null; createdBy: string | null; createdAt: string };
  statuses: Record<string, number>;
  vouchers: { id: string; displayCode: string; codeLast4: string; status: string; expiresAt: string | null; redeemedAt: string | null; redeemedBy: string | null }[];
};

const STATUS_BADGE: Record<string, string> = {
  UNUSED: "bg-brand/15 text-brand",
  REDEEMED: "bg-green-500/15 text-green-400",
  EXPIRED: "bg-hover-tint text-ink3",
  CANCELLED: "bg-red-500/15 text-red-400",
  SUSPENDED: "bg-amber-500/15 text-amber-400",
};

/** Batch detail — all vouchers in a generation group + status breakdown. */
export default function VoucherBatchPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<BatchDetail | null>(null);

  useEffect(() => {
    apiFetch<BatchDetail>(`/api/admin/voucher-batches/${id}`).then((r) => r.ok && setData(r.data));
  }, [id]);

  if (!data) return <div className="card p-10 text-center text-sm text-ink3">Loading batch…</div>;
  const { batch, statuses, vouchers } = data;

  const statusLabels: [string, string][] = [
    ["UNUSED", "unused"],
    ["REDEEMED", "redeemed"],
    ["EXPIRED", "expired"],
    ["CANCELLED", "cancelled"],
    ["SUSPENDED", "suspended"],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold">{batch.name ?? `Batch ${batch.id.slice(-6)}`}</h1>
          <p className="text-sm text-ink3">
            {batch.currency} {batch.value.toLocaleString()} · {vouchers.length} vouchers · created {new Date(batch.createdAt).toLocaleString()}
            {batch.createdBy ? ` by ${batch.createdBy}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link className="btn btn-ghost btn-sm" href="/admin/vouchers">← Vouchers</Link>
          <Link className="btn btn-primary btn-sm" href={`/admin/vouchers/print?batchId=${batch.id}&value=${batch.value}&currency=${batch.currency}`} target="_blank">
            Print sheets
          </Link>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {statusLabels.map(([key, label]) => (
          <div key={key} className="card p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{label}</div>
            <div className="mt-1 text-lg font-extrabold tabular-nums">{statuses[key] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink3">
              <th className="px-4 py-2.5">Voucher</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Expiry</th>
              <th className="px-4 py-2.5">Redeemed</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => (
              <tr key={v.id} className="border-b border-line/50">
                <td className="px-4 py-2 font-mono text-xs">{v.displayCode}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_BADGE[v.status] ?? "bg-hover-tint text-ink3"}`}>{v.status}</span>
                </td>
                <td className="px-4 py-2 text-xs text-ink2">{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-2 text-xs text-ink2">
                  {v.redeemedAt ? `${new Date(v.redeemedAt).toLocaleString()}${v.redeemedBy ? ` by ${v.redeemedBy.slice(0, 8)}…` : ""}` : "—"}
                </td>
                <td className="px-4 py-2">
                  <Link href={`/admin/vouchers/${v.id}`} className="text-xs font-bold text-brand hover:underline">Details</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
