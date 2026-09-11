"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { useCurrency } from "@/components/CurrencyProvider";
import CopyButton from "@/components/CopyButton";
import { formatDateTime } from "@/lib/odds";
import {
  ChevronDown,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  ScrollText,
  Ban,
  CheckCircle2,
  Loader2,
} from "lucide-react";

type UserRow = {
  id: string; fullName: string; username: string; email: string; phone: string;
  status: string; verified: boolean; balance: number; currencyCode: string;
  betCount: number; createdAt: string; lastLoginAt: string | null;
};

type UserDetails = {
  user: {
    id: string; fullName: string; username: string; email: string; phone: string;
    country: string | null; status: string; verified: boolean; role: string;
    currencyCode: string; hasDeposited: boolean; referralCode: string | null;
    lastLoginAt: string | null; createdAt: string;
  };
  wallet: { balance: number; bonusBalance: number; currencyCode: string };
  financials: {
    totalDeposits: number; totalWithdrawals: number; totalStaked: number;
    totalReturns: number; netPnl: number; adjustments: number; currencyCode: string;
  };
  counts: { bets: number; deposits: number; withdrawals: number };
  bets: {
    id: string; code: string; type: string; stake: number; totalOdds: number;
    potentialWin: number; status: string; createdAt: string;
    selections: { marketName: string; outcomeName: string; odds: number; result: string | null }[];
  }[];
  transactions: {
    id: string; type: string; method: string | null; amount: number;
    currencyCode: string; reason: string | null; reference: string | null; createdAt: string;
  }[];
};

type AuditEntry = {
  id: string; adminName: string | null; action: string; entity: string;
  entityId: string | null; createdAt: string; newValue: string | null;
};

const BET_STATUS: Record<string, string> = {
  OPEN: "bg-blue-500/15 text-blue-400",
  WON: "bg-green-500/15 text-green-400",
  LOST: "bg-red-500/15 text-red-400",
  VOID: "bg-gray-500/15 text-gray-400",
};

export default function AdminUsers() {
  const { push } = useToast();
  const { code: activeCur, formatCurrency, convertAmount } = useCurrency();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    fullName: "", username: "", email: "", phone: "", password: "",
    role: "CUSTOMER", status: "ACTIVE", currencyCode: "KES", initialBalance: "0",
  });
  const [saving, setSaving] = useState(false);

  // Accordion
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, UserDetails>>({});
  const [audits, setAudits] = useState<Record<string, AuditEntry[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${id}:${action}`

  // Adjust-balance inline form
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  // Reset-password result (shown once)
  const [tempPw, setTempPw] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    apiFetch<{ users: UserRow[] }>(`/api/admin/users?${params}`).then((r) => r.ok && setUsers(r.data.users));
  }, [q, status]);

  function reloadList() {
    return apiFetch<{ users: UserRow[] }>(`/api/admin/users`).then((r) => r.ok && setUsers(r.data.users));
  }

  async function loadDetails(id: string) {
    setLoadingId(id);
    const [d, a] = await Promise.all([
      apiFetch<UserDetails>(`/api/admin/users/${id}`),
      apiFetch<{ logs: AuditEntry[] }>(`/api/admin/audit?entity=USER&entityId=${encodeURIComponent(id)}`),
    ]);
    if (d.ok) setDetails((cur) => ({ ...cur, [id]: d.data }));
    else push("error", d.error.message);
    if (a.ok) setAudits((cur) => ({ ...cur, [id]: a.data.logs.slice(0, 6) }));
    setLoadingId(null);
  }

  function toggle(u: UserRow) {
    if (expandedUserId === u.id) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(u.id);
    setAdjAmount("");
    setAdjReason("");
    void loadDetails(u.id);
  }

  async function patchUser(id: string, body: Record<string, unknown>) {
    const res = await apiFetch(`/api/admin/users/${id}`, { method: "PATCH", body });
    if (!res.ok) return push("error", res.error.message);
    push("success", "User updated");
    await reloadList();
    if (details[id]) void loadDetails(id);
  }

  async function adjustBalance(id: string) {
    const amount = parseFloat(adjAmount);
    if (!Number.isFinite(amount) || amount === 0) return push("error", "Enter a non-zero amount.");
    if (adjReason.trim().length < 3) return push("error", "Provide a reason (audited).");
    setBusy(`${id}:balance`);
    const res = await apiFetch(`/api/admin/users/${id}/balance`, {
      method: "POST",
      body: { amount, reason: adjReason.trim() },
    });
    setBusy(null);
    if (!res.ok) return push("error", res.error.message);
    push("success", `Balance adjusted by ${amount > 0 ? "+" : ""}${amount}`);
    setAdjAmount("");
    setAdjReason("");
    await reloadList();
    void loadDetails(id);
  }

  async function resetPassword(id: string) {
    setBusy(`${id}:pw`);
    const res = await apiFetch<{ tempPassword: string }>(`/api/admin/users/${id}/reset-password`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!res.ok) return push("error", res.error.message);
    setTempPw((cur) => ({ ...cur, [id]: res.data.tempPassword }));
    push("success", "Password reset — copy the temporary password now.");
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await apiFetch<{ user: { username: string } }>("/api/admin/users", {
      method: "POST",
      body: { ...form, initialBalance: Number(form.initialBalance) },
    });
    setSaving(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", `User @${res.data.user.username} created — verified & active.`);
    setCreating(false);
    setForm({ fullName: "", username: "", email: "", phone: "", password: "", role: "CUSTOMER", status: "ACTIVE", currencyCode: "KES", initialBalance: "0" });
    reloadList();
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
        {users.map((u) => {
          const open = expandedUserId === u.id;
          const d = details[u.id];
          return (
            <div key={u.id}>
              {/* ── Row (accordion trigger) ─────────────────────── */}
              <button
                type="button"
                aria-expanded={open}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                  open ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"
                }`}
                onClick={() => toggle(u)}
              >
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
                <span className="hidden w-28 text-right text-sm font-bold text-green-400 sm:block">
                  {formatCurrency(convertAmount(u.balance, u.currencyCode, activeCur), activeCur)}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-ink3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
              </button>

              {/* ── Expanded details ────────────────────────────── */}
              {open && (
                <div className="rise-in border-t border-line/70 bg-card2/20 px-4 py-4 sm:px-5">
                  {loadingId === u.id && !d ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink3">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading user details…
                    </div>
                  ) : d ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-3">
                        {/* Profile Overview */}
                        <Section title="Profile Overview" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                          <Field label="Full name" value={d.user.fullName} />
                          <Field label="Username" value={`@${d.user.username}`} />
                          <Field label="Phone" value={d.user.phone} mono />
                          <Field label="Email" value={d.user.email} />
                          <Field label="Registered" value={formatDateTime(new Date(d.user.createdAt))} />
                          <Field
                            label="KYC verification"
                            value={
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${d.user.verified ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
                                {d.user.verified ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                                {d.user.verified ? "Verified" : "Unverified"}
                              </span>
                            }
                          />
                          <Field label="Last login" value={d.user.lastLoginAt ? formatDateTime(new Date(d.user.lastLoginAt)) : "Never"} />
                        </Section>

                        {/* Financials */}
                        <Section title="Financials" icon={<Wallet className="h-3.5 w-3.5" />}>
                          <div className="grid grid-cols-2 gap-2">
                            <Stat label="Active balance" value={formatCurrency(convertAmount(d.wallet.balance, d.wallet.currencyCode, activeCur), activeCur)} tone="brand" />
                            <Stat label="Bonus balance" value={formatCurrency(convertAmount(d.wallet.bonusBalance, d.wallet.currencyCode, activeCur), activeCur)} tone="amber" />
                            <Stat label="Total deposits" value={formatCurrency(convertAmount(d.financials.totalDeposits, d.financials.currencyCode, activeCur), activeCur)} icon={<ArrowDownToLine className="h-3 w-3" />} />
                            <Stat label="Total withdrawals" value={formatCurrency(convertAmount(d.financials.totalWithdrawals, d.financials.currencyCode, activeCur), activeCur)} icon={<ArrowUpFromLine className="h-3 w-3" />} />
                            <Stat
                              label="Net P&L (bets)"
                              value={`${d.financials.netPnl >= 0 ? "+" : "−"}${formatCurrency(Math.abs(convertAmount(d.financials.netPnl, d.financials.currencyCode, activeCur)), activeCur)}`}
                              tone={d.financials.netPnl >= 0 ? "green" : "red"}
                              icon={d.financials.netPnl >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            />
                            <Stat label="Bets placed" value={String(d.counts.bets)} />
                          </div>
                          <p className="mt-2 text-[10px] leading-snug text-ink3">
                            Net P&L is the customer&apos;s betting result (returns − stakes). Deposits/withdrawals are lifetime wallet totals.
                          </p>
                        </Section>

                        {/* Admin Actions */}
                        <Section title="Admin Actions" icon={<KeyRound className="h-3.5 w-3.5" />}>
                          {/* Adjust balance */}
                          <div className="rounded-xl border border-line bg-card2/40 p-3">
                            <div className="text-[11px] font-bold text-ink2">Adjust balance</div>
                            <div className="mt-2 flex gap-2">
                              <input
                                className="input !py-1.5 text-sm"
                                type="number"
                                step="any"
                                placeholder="e.g. 500 or -200"
                                value={adjAmount}
                                onChange={(e) => setAdjAmount(e.target.value)}
                              />
                            </div>
                            <input
                              className="input mt-2 !py-1.5 text-sm"
                              placeholder="Reason (audited)"
                              value={adjReason}
                              onChange={(e) => setAdjReason(e.target.value)}
                            />
                            <button
                              className="btn btn-primary btn-sm mt-2 w-full"
                              disabled={busy === `${u.id}:balance`}
                              onClick={() => adjustBalance(u.id)}
                            >
                              {busy === `${u.id}:balance` ? "Applying…" : "Apply adjustment"}
                            </button>
                          </div>

                          {/* Status + reset actions */}
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {u.status === "SUSPENDED" ? (
                              <button className="btn btn-ghost btn-sm" disabled={busy === `${u.id}:status`} onClick={() => patchUser(u.id, { status: "ACTIVE" })}>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Reactivate
                              </button>
                            ) : (
                              <button className="btn btn-danger btn-sm" disabled={busy === `${u.id}:status`} onClick={() => patchUser(u.id, { status: "SUSPENDED" })}>
                                <Ban className="mr-1 h-3.5 w-3.5" /> Suspend / Freeze
                              </button>
                            )}
                            <button className="btn btn-ghost btn-sm" onClick={() => patchUser(u.id, { verified: true })}>
                              Verify identity
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => patchUser(u.id, { status: "PENDING_VERIFICATION" })}>
                              Require verification
                            </button>
                            <button className="btn btn-ghost btn-sm" disabled={busy === `${u.id}:pw`} onClick={() => resetPassword(u.id)}>
                              <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset password
                            </button>
                          </div>

                          {tempPw[u.id] && (
                            <div className="fade-in mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Temporary password (shown once)</div>
                              <div className="mt-1 flex items-center gap-2">
                                <code className="min-w-0 flex-1 break-all rounded bg-black/30 px-2 py-1 font-mono text-xs text-amber-200">{tempPw[u.id]}</code>
                                <CopyButton text={tempPw[u.id]} label="Copy" title="Copy the temporary password" />
                              </div>
                            </div>
                          )}

                          <div className="mt-3 flex items-center gap-2">
                            <CopyButton text={u.email} label="Email" title="Copy this user's email" />
                            <CopyButton text={u.id} label="User ID" title="Copy this user's ID" />
                          </div>
                        </Section>
                      </div>

                      {/* Activity stream */}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <Section title="Recent Bets" icon={<ScrollText className="h-3.5 w-3.5" />}>
                          {d.bets.length === 0 ? (
                            <p className="text-xs text-ink3">No bets yet.</p>
                          ) : (
                            <ul className="space-y-2">
                              {d.bets.map((b) => (
                                <li key={b.id} className="rounded-xl border border-line bg-card2/30 p-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[11px] font-bold text-ink">{b.code}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${BET_STATUS[b.status] ?? "bg-card2 text-ink2"}`}>{b.status}</span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink3">
                                    <span>{b.type === "MULTIPLE" ? `${b.selections.length}-fold` : "Single"}</span>
                                    <span>Stake <span className="font-semibold text-ink2">{formatCurrency(convertAmount(b.stake, d.wallet.currencyCode, activeCur), activeCur)}</span></span>
                                    <span>@ {b.totalOdds.toFixed(2)}</span>
                                    <span className="ml-auto">{formatDateTime(new Date(b.createdAt), { date: false })}</span>
                                  </div>
                                  {b.selections.slice(0, 3).map((s, i) => (
                                    <div key={i} className="mt-1 truncate text-[11px] text-ink2">
                                      <span className="text-ink3">{s.marketName}:</span> {s.outcomeName}{" "}
                                      <span className="text-ink3">@{s.odds.toFixed(2)}</span>
                                      {s.result && <span className={`ml-1 font-semibold ${s.result === "WON" ? "text-green-400" : s.result === "LOST" ? "text-red-400" : "text-ink3"}`}>· {s.result}</span>}
                                    </div>
                                  ))}
                                  {b.selections.length > 3 && (
                                    <div className="mt-0.5 text-[10px] text-ink3">+{b.selections.length - 3} more selection(s)</div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Section>

                        <Section title="Recent Transactions" icon={<Wallet className="h-3.5 w-3.5" />}>
                          {d.transactions.length === 0 ? (
                            <p className="text-xs text-ink3">No transactions yet.</p>
                          ) : (
                            <ul className="divide-y divide-line/60">
                              {d.transactions.map((t) => (
                                <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-ink2">{t.type.replace(/_/g, " ")}{t.method ? ` · ${t.method}` : ""}</div>
                                    <div className="truncate text-[10px] text-ink3">{t.reason ?? t.reference ?? "—"}</div>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <div className={`font-bold ${["BET_STAKE", "WITHDRAWAL"].includes(t.type) ? "text-red-400" : "text-green-400"}`}>
                                      {["BET_STAKE", "WITHDRAWAL"].includes(t.type) ? "−" : "+"}
                                      {formatCurrency(convertAmount(t.amount, t.currencyCode, activeCur), activeCur)}
                                    </div>
                                    <div className="text-[10px] text-ink3">{formatDateTime(new Date(t.createdAt), { date: false })}</div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Section>
                      </div>

                      {/* Audit ledger */}
                      <Section title="Audit Ledger" icon={<ScrollText className="h-3.5 w-3.5" />}>
                        {!audits[u.id] || audits[u.id].length === 0 ? (
                          <p className="text-xs text-ink3">No audit entries for this user.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {audits[u.id].map((a) => (
                              <li key={a.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink2">
                                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent">{a.action}</span>
                                <span className="text-ink3">by {a.adminName ?? "system"}</span>
                                <span className="ml-auto text-ink3">{formatDateTime(new Date(a.createdAt))}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <a href={`/admin/audit`} className="mt-2 inline-block text-[11px] font-semibold text-brand hover:underline">
                          Open full audit ledger →
                        </a>
                      </Section>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-sm text-ink3">Could not load details.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add User modal */}
      {creating && (
        <>
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
    </div>
  );
}

/* ── Small presentational helpers ──────────────────────────── */

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card/60 p-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-ink3">{label}</span>
      <span className={`text-right text-ink2 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "brand" | "amber" | "green" | "red";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "brand"
      ? "text-brand"
      : tone === "amber"
        ? "text-amber-400"
        : tone === "green"
          ? "text-green-400"
          : tone === "red"
            ? "text-red-400"
            : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-card2/40 p-2.5">
      <div className="flex items-center gap-1 text-[10px] font-medium text-ink3">
        {icon}
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-extrabold ${toneClass}`}>{value}</div>
    </div>
  );
}
