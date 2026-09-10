"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconSend } from "@/components/icons";

type Broadcast = {
  id: string;
  title: string;
  message: string;
  targetType: string;
  userId: string | null;
  createdAt: string;
  status: "live" | "expired" | "deactivated";
  audience: string;
  expiresAt: string | null;
  active: boolean;
  targetIds: string[];
};

type NotificationSend = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  recipients: string;
  read: boolean;
};

const EMPTY = { title: "", message: "", audience: "ALL", userIds: "", ttlHours: "" };

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const STATUS_STYLE: Record<Broadcast["status"], string> = {
  live: "bg-green-500/15 text-green-600 dark:text-green-400",
  expired: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  deactivated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export default function AdminBroadcast() {
  const { push } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [sends, setSends] = useState<NotificationSend[]>([]);
  const [ttlHours, setTtlHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  type Payload = { broadcasts: Broadcast[]; ttlHours: number; notifications: NotificationSend[] };

  const apply = (data: Payload) => {
    setHistory(data.broadcasts);
    setTtlHours(data.ttlHours);
    setSends(data.notifications ?? []);
  };

  /** Re-fetch after a mutation (event handlers only — not from an effect body). */
  const reload = async () => {
    const res = await apiFetch<Payload>("/api/admin/broadcast");
    if (res.ok) apply(res.data);
  };

  useEffect(() => {
    let alive = true;
    apiFetch<Payload>("/api/admin/broadcast").then((res) => {
      if (!alive || !res.ok) return;
      setHistory(res.data.broadcasts);
      setTtlHours(res.data.ttlHours);
      setSends(res.data.notifications ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch<{ message: string }>("/api/admin/broadcast", {
      method: "POST",
      body: {
        title: form.title,
        message: form.message,
        targetType: form.audience,
        userIds: form.userIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        ...(form.ttlHours ? { expiresAt: new Date(Date.now() + Number(form.ttlHours) * 3600_000).toISOString() } : {}),
      },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    setForm(EMPTY);
    reload();
  }

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    setBusy(id);
    const res = await apiFetch<{ message: string }>(`/api/admin/broadcast/${id}`, { method: "PATCH", body });
    setBusy(null);
    if (!res.ok) return push("error", res.error.message);
    push("success", ok);
    reload();
  }

  async function remove(id: string) {
    setBusy(id);
    const res = await apiFetch<{ message: string }>(`/api/admin/broadcast/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Broadcast deleted");
    reload();
  }

  async function removeSend(id: string, all: boolean) {
    setBusy(id);
    const res = await apiFetch<{ message: string }>(`/api/admin/notifications/${id}${all ? "?all=1" : ""}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    reload();
  }

  const live = history.filter((b) => b.status === "live").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Broadcast</h2>
          <p className="text-sm text-ink2">
            Site-wide banners + notification-centre messages. {live} live · {history.length} total
            {ttlHours !== null && (
              <>
                {" "}
                · banners auto-hide after <b>{ttlHours === 0 ? "never (disabled)" : `${ttlHours}h`}</b>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Compose ─────────────────────────────────────────────── */}
      <form onSubmit={send} className="card max-w-2xl space-y-4 p-6">
        <div>
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Maintenance notice" required />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea className="input" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Audience</label>
            <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              <option value="ALL">Everyone (visitors + users)</option>
              <option value="ACTIVE">Signed-in users only</option>
              <option value="USER_IDS">Specific users</option>
            </select>
          </div>
          <div>
            <label className="label">Hide after (hours, optional)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.ttlHours}
              onChange={(e) => setForm({ ...form, ttlHours: e.target.value })}
              placeholder={ttlHours ? `default ${ttlHours}h` : "never"}
            />
          </div>
        </div>
        {form.audience === "USER_IDS" && (
          <div>
            <label className="label">Users (IDs, emails or @usernames — comma or line separated)</label>
            <textarea className="input font-mono text-xs" rows={2} value={form.userIds} onChange={(e) => setForm({ ...form, userIds: e.target.value })} placeholder="player@example.com, @johndoe" />
          </div>
        )}
        <button className="btn btn-primary inline-flex items-center gap-2" disabled={loading}>
          <IconSend className="h-4 w-4" />
          {loading ? "Sending…" : "Send broadcast"}
        </button>
        <p className="text-xs text-ink3">
          Appears as a dismissible banner site-wide (or to the chosen users) and in the notification centre. Every send is
          listed below and can be deactivated or deleted at any time.
        </p>
      </form>

      {/* ── Older announcement sends (notification centre only) ── */}
      <div className="card p-6">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-ink3">Announcement messages (notification centre)</h3>
        <p className="mt-1 text-xs text-ink3">
          Sent from the old Announcements form: these went to players&apos; bells only, not the site-wide banner. Kept here so
          every send is visible and can be removed.
        </p>
        {!sends.length ? (
          <p className="mt-3 text-sm text-ink3">None yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {sends.map((n) => (
              <div key={n.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line bg-card2/40 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{n.title}</span>
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">{n.recipients}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink2">{n.message}</p>
                  <p className="mt-1 text-[11px] text-ink3">Sent {fmt(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === n.id} onClick={() => removeSend(n.id, false)}>
                    Remove one
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm text-red-500" disabled={busy === n.id} onClick={() => removeSend(n.id, true)}>
                    Remove all copies
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── History ─────────────────────────────────────────────── */}
      <div className="card p-6">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-ink3">Sent broadcasts</h3>
        {!history.length ? (
          <p className="mt-3 text-sm text-ink3">
            Nothing sent yet. Anything you send appears here with its audience, status and expiry — and can be turned off
            without deleting the record.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {history.map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-card2/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{b.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${STATUS_STYLE[b.status]}`}>
                        {b.status}
                      </span>
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">{b.audience}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink2">{b.message}</p>
                    <p className="mt-1 text-[11px] text-ink3">
                      Sent {fmt(b.createdAt)}
                      {b.expiresAt ? ` · hides ${fmt(b.expiresAt)}` : ""}
                      {b.targetIds.length > 1 ? ` · ${b.targetIds.length} recipients` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === b.id}
                      onClick={() => patch(b.id, { active: !b.active }, b.active ? "Broadcast deactivated" : "Broadcast reactivated")}
                    >
                      {b.active ? "Deactivate" : "Reactivate"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === b.id || !b.expiresAt}
                      onClick={() => patch(b.id, { clearExpiry: true }, "Expiry cleared")}
                    >
                      Clear expiry
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === b.id}
                      onClick={() => setForm({ title: b.title, message: b.message, audience: b.targetType, userIds: b.targetIds.join(", "), ttlHours: "" })}
                    >
                      Reuse
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-red-500"
                      disabled={busy === b.id}
                      onClick={() => remove(b.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
