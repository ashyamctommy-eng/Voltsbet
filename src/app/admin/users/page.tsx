"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type UserRow = {
  id: string; fullName: string; username: string; email: string; phone: string;
  status: string; verified: boolean; balance: number; currencyCode: string;
  betCount: number; createdAt: string; lastLoginAt: string | null;
};

export default function AdminUsers() {
  const { push } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<UserRow | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    apiFetch<{ users: UserRow[] }>(`/api/admin/users?${params}`).then((r) => r.ok && setUsers(r.data.users));
  }, [q, status]);

  async function patchUser(id: string, body: Record<string, unknown>) {
    const res = await apiFetch(`/api/admin/users/${id}`, { method: "PATCH", body });
    if (!res.ok) return push("error", res.error.message);
    push("success", "User updated");
    const r = await apiFetch<{ users: UserRow[] }>(`/api/admin/users`);
    if (r.ok) setUsers(r.data.users);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Users ({users.length})</h2>
        <div className="flex gap-3">
          <input className="input w-52" placeholder="Search username / email / name" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_VERIFICATION">Pending Verification</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="SELF_EXCLUDED">Self-Excluded</option>
          </select>
        </div>
      </div>

      <div className="card divide-y divide-line">
        {users.length === 0 && <div className="p-8 text-center text-sm text-ink3">No users.</div>}
        {users.map((u) => (
          <button key={u.id} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]" onClick={() => setSelected(u)}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent">
              {u.username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{u.fullName} <span className="text-ink3">@{u.username}</span></div>
              <div className="truncate text-xs text-ink3">{u.email} · {u.phone}</div>
            </div>
            <span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-bold sm:block ${u.verified ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
              {u.verified ? "VERIFIED" : "UNVERIFIED"}
            </span>
            <span className="rounded-full bg-card2 px-2.5 py-1 text-[10px] font-bold uppercase text-ink2">{u.status.replace("_", " ")}</span>
            <span className="w-24 text-right text-sm font-bold text-green-400">{Number(u.balance).toLocaleString()} {u.currencyCode}</span>
          </button>
        ))}
      </div>

      {/* User detail modal */}
      {selected && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="fade-in absolute inset-0 bg-black/70" onClick={() => setSelected(null)} />
          <div className="fade-in card w-full max-w-lg p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">{selected.fullName} <span className="text-ink3">@{selected.username}</span></h3>
                <p className="text-xs text-ink3">{selected.email} · {selected.phone} · {selected.betCount} bets · joined {new Date(selected.createdAt).toLocaleDateString("en-GB")}</p>
              </div>
              <button className="text-ink3 hover:text-ink" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button className="btn btn-ghost btn-sm" onClick={() => { patchUser(selected.id, { verified: true }); }}>Verify identity</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { patchUser(selected.id, { status: "ACTIVE" }); }}>Set Active</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { patchUser(selected.id, { status: "PENDING_VERIFICATION" }); }}>Require verification</button>
              <button className="btn btn-danger btn-sm" onClick={() => { patchUser(selected.id, { status: "SUSPENDED" }); }}>Suspend</button>
            </div>
            <div className="mt-4 border-t border-line pt-4 text-xs text-ink3">
              All status changes are audited and the user is notified.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
