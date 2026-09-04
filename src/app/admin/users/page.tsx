"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { useCurrency } from "@/components/CurrencyProvider";

type UserRow = {
  id: string; fullName: string; username: string; email: string; phone: string;
  status: string; verified: boolean; balance: number; currencyCode: string;
  betCount: number; createdAt: string; lastLoginAt: string | null;
};

export default function AdminUsers() {
  const { push } = useToast();
  const { code: activeCur, formatCurrency, convertAmount } = useCurrency();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    fullName: "", username: "", email: "", phone: "", password: "",
    role: "CUSTOMER", status: "ACTIVE", currencyCode: "KES", initialBalance: "0",
  });
  const [saving, setSaving] = useState(false);

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

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await apiFetch<{ user: { username: string } }>("/api/admin/users", {
      method: "POST",
      body: {
        ...form,
        initialBalance: Number(form.initialBalance),
      },
    });
    setSaving(false);
    if (!res.ok) {
      setSaving(false);
      return push("error", res.error.message);
    }
    push("success", `User @${res.data.user.username} created — verified & active.`);
    setCreating(false);
    setForm({ fullName: "", username: "", email: "", phone: "", password: "", role: "CUSTOMER", status: "ACTIVE", currencyCode: "KES", initialBalance: "0" });
    const r = await apiFetch<{ users: UserRow[] }>(`/api/admin/users`);
    if (r.ok) setUsers(r.data.users);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Users ({users.length})</h2>
        <div className="flex gap-3">
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + Add User
          </button>
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
            <span className="w-28 text-right text-sm font-bold text-green-400">{formatCurrency(convertAmount(u.balance, u.currencyCode, activeCur), activeCur)}</span>
          </button>
        ))}
      </div>

      {/* Add User modal — create a real (non-demo) account */}
      {creating && (
        <>
          {/* Backdrop — UNDER the dialog layer */}
          <div className="fade-in fixed inset-0 z-40 bg-black/60 pointer-events-auto" onClick={() => setCreating(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <form onSubmit={createUser} className="fade-in card pointer-events-auto max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">Add User</h3>
                <p className="text-xs text-ink3">Creates a real account — verified &amp; active immediately (no demo/seed).</p>
              </div>
              <button type="button" className="text-ink3 hover:text-ink" onClick={() => setCreating(false)}>✕</button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Full name</label>
                <input className="input" required minLength={2} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Jane Muthoni" />
              </div>
              <div>
                <label className="label">Username</label>
                <input className="input" required minLength={3} pattern="[a-zA-Z0-9_]+" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="jane_m" />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" required pattern="\+?[0-9]{9,15}" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+2547…" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Email</label>
                <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@example.com" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Password (min 8, letters + numbers)</label>
                <input className="input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="CUSTOMER">Customer</option>
                  <option value="SPORTS_MANAGER">Sports Manager</option>
                  <option value="FINANCE_MANAGER">Finance Manager</option>
                  <option value="SUPPORT_MANAGER">Support Manager</option>
                  <option value="CONTENT_MANAGER">Content Manager</option>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING_VERIFICATION">Pending Verification</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
              <div>
                <label className="label">Currency</label>
                <select className="input" value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}>
                  {["KES", "USD", "EUR", "UGX", "TZS", "GHS"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Initial balance</label>
                <input className="input" type="number" min="0" step="any" value={form.initialBalance} onChange={(e) => setForm({ ...form, initialBalance: e.target.value })} />
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button type="button" className="btn btn-ghost flex-1" onClick={() => setCreating(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={saving}>
                {saving ? "Creating…" : "Create User"}
              </button>
            </div>
          </form>
          </div>
        </>
      )}

      {/* User detail modal */}
      {selected && (
        <>
          {/* Backdrop — UNDER the dialog layer */}
          <div className="fade-in fixed inset-0 z-40 bg-black/60 pointer-events-auto" onClick={() => setSelected(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <div className="fade-in card pointer-events-auto w-full max-w-lg p-6">
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
        </>
      )}
    </div>
  );
}
