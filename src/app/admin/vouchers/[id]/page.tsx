"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type VoucherDetail = {
  voucher: {
    id: string;
    displayCode: string;
    codeLast4: string;
    value: number;
    currency: string;
    status: string;
    batchName: string | null;
    notes: string | null;
    createdAt: string;
    createdBy: string | null;
    expiresAt: string | null;
    redeemedAt: string | null;
    redeemedBy: { id: string; username: string; email: string } | null;
    cancelledAt: string | null;
    cancelledBy: string | null;
    suspendedAt: string | null;
    suspendedBy: string | null;
    redemption: { amount: number; currency: string; redeemedAt: string; ipAddress: string | null; deviceInfo: string | null; transactionId: string | null } | null;
  };
  audit: { id: string; action: string; adminName: string | null; userId: string | null; ip: string | null; prevValue: string | null; newValue: string | null; createdAt: string }[];
};

const STATUS_BADGE: Record<string, string> = {
  UNUSED: "bg-brand/15 text-brand",
  REDEEMED: "bg-green-500/15 text-green-400",
  EXPIRED: "bg-hover-tint text-ink3",
  CANCELLED: "bg-red-500/15 text-red-400",
  SUSPENDED: "bg-amber-500/15 text-amber-400",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/50 py-2.5 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink3">{label}</span>
      <span className="text-right font-semibold text-ink">{children}</span>
    </div>
  );
}

export default function VoucherDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { push } = useToast();
  const [data, setData] = useState<VoucherDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiFetch<VoucherDetail>(`/api/admin/vouchers/${id}`).then((r) => r.ok && setData(r.data));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(action: "cancel" | "suspend" | "reactivate") {
    setBusy(true);
    const res = await apiFetch(`/api/admin/vouchers/${id}`, { method: "POST", body: { action } });
    setBusy(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", `Voucher ${action === "cancel" ? "cancelled" : action === "suspend" ? "suspended" : "reactivated"}.`);
    void load();
  }

  if (!data) {
    return <div className="card p-10 text-center text-sm text-ink3">Loading voucher…</div>;
  }
  const v = data.voucher;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/admin/vouchers" className="btn btn-ghost btn-sm">← Vouchers</Link>
        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase ${STATUS_BADGE[v.status] ?? "bg-hover-tint text-ink3"}`}>{v.status}</span>
      </div>

      <div className="card p-5">
        <h1 className="font-mono text-lg font-extrabold">{v.displayCode}</h1>
        <p className="text-xs text-ink3">ID: {v.id} · full code is stored only as a hash</p>
        <div className="mt-4">
          <Row label="Value"><span className="tabular-nums">{v.value.toLocaleString()} {v.currency}</span></Row>
          <Row label="Created">{new Date(v.createdAt).toLocaleString()}{v.createdBy ? ` by ${v.createdBy}` : ""}</Row>
          <Row label="Batch">{v.batchName ?? "—"}</Row>
          <Row label="Expiry">{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : "—"}</Row>
          <Row label="Notes">{v.notes ?? "—"}</Row>
          {v.status === "REDEEMED" && v.redemption && (
            <>
              <Row label="Redeemed by">{v.redeemedBy?.username ?? "—"} ({v.redeemedBy?.email ?? v.redeemedBy?.id ?? ""})</Row>
              <Row label="Redeemed at">{new Date(v.redemption.redeemedAt).toLocaleString()}</Row>
              <Row label="Transaction ID"><span className="font-mono">{v.redemption.transactionId ?? "—"}</span></Row>
              <Row label="Amount credited">{v.redemption.amount.toLocaleString()} {v.redemption.currency}</Row>
              {v.redemption.ipAddress && <Row label="IP address">{v.redemption.ipAddress}</Row>}
              {v.redemption.deviceInfo && <Row label="Device">{v.redemption.deviceInfo.slice(0, 80)}</Row>}
            </>
          )}
          {v.status === "CANCELLED" && <Row label="Cancelled">{v.cancelledAt ? new Date(v.cancelledAt).toLocaleString() : "—"} by {v.cancelledBy ?? "—"}</Row>}
          {v.status === "SUSPENDED" && <Row label="Suspended">{v.suspendedAt ? new Date(v.suspendedAt).toLocaleString() : "—"} by {v.suspendedBy ?? "—"}</Row>}
        </div>

        {v.status !== "REDEEMED" && v.status !== "EXPIRED" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {v.status === "UNUSED" && (
              <>
                <button className="btn btn-ghost !border-amber-500/40 !text-amber-400" disabled={busy} onClick={() => act("suspend")}>Suspend</button>
                <button className="btn btn-ghost !border-red-500/40 !text-red-400" disabled={busy} onClick={() => act("cancel")}>Cancel</button>
              </>
            )}
            {(v.status === "CANCELLED" || v.status === "SUSPENDED") && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act("reactivate")}>Reactivate</button>
            )}
          </div>
        )}
      </div>

      {/* Audit trail */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-bold">Audit history</h2>
        {data.audit.length === 0 ? (
          <p className="text-xs text-ink3">No audit entries.</p>
        ) : (
          <div className="space-y-2">
            {data.audit.map((a) => (
              <div key={a.id} className="rounded-lg bg-card2 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-brand">{a.action}</span>
                  <span className="text-ink3">{a.adminName ?? a.userId ?? "system"} · {new Date(a.createdAt).toLocaleString()}{a.ip ? ` · ${a.ip}` : ""}</span>
                </div>
                {(a.prevValue || a.newValue) && (
                  <pre className="mt-1 overflow-x-auto font-mono text-[10px] text-ink3">
                    {a.prevValue ? `prev: ${a.prevValue}` : ""}{a.prevValue && a.newValue ? "\n" : ""}{a.newValue ? `new: ${a.newValue}` : ""}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
