"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconBell, IconSend, IconX } from "@/components/icons";

type Broadcast = {
  id: string;
  title: string;
  message: string;
  targetType: string;
  userId: string | null;
  createdAt: string;
  user?: { username: string; email: string } | null;
};

const EMPTY = { title: "", message: "", targetType: "ALL", userId: "" };

/** Admin header button that opens the broadcast messaging drawer. */
export default function AdminBroadcastButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1 text-sm font-semibold text-brand transition-colors hover:bg-brand/25"
      >
        <IconBell className="h-4 w-4" /> Announce
      </button>
      {open && <BroadcastDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function BroadcastDrawer({ onClose }: { onClose: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Broadcast[]>([]);

  const reload = () => {
    apiFetch<{ broadcasts: Broadcast[] }>("/api/admin/broadcast").then((res) => {
      if (res.ok) setHistory(res.data.broadcasts);
    });
  };

  useEffect(() => {
    reload();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch<{ broadcast: Broadcast }>("/api/admin/broadcast", {
      method: "POST",
      body: {
        title: form.title,
        message: form.message,
        targetType: form.targetType,
        userId: form.targetType === "USER" ? form.userId : undefined,
      },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Announcement broadcast sent");
    setForm(EMPTY);
    reload();
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Broadcast announcement">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-extrabold">Broadcast Announcement</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink3 hover:bg-white/5 hover:text-ink" aria-label="Close">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={send} className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Maintenance at 2:00 AM EAT"
              required
            />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea
              className="input"
              rows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="What players need to know…"
              required
            />
          </div>
          <div>
            <label className="label">Target</label>
            <select
              className="input"
              value={form.targetType}
              onChange={(e) => setForm({ ...form, targetType: e.target.value })}
            >
              <option value="ALL">All users (global broadcast)</option>
              <option value="USER">Individual user</option>
            </select>
          </div>
          {form.targetType === "USER" && (
            <div>
              <label className="label">User ID</label>
              <input
                className="input"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                placeholder="User id (find it on /admin/users)"
                required
              />
            </div>
          )}
          <button className="btn btn-primary inline-flex w-full items-center justify-center gap-2" disabled={loading}>
            <IconSend className="h-4 w-4" />
            {loading ? "Sending…" : "Send Broadcast"}
          </button>
          <p className="text-xs text-ink3">
            Shows as a dismissible banner site-wide (or to that user), and appears in their notification center.
          </p>
        </form>

        <div className="flex-1 overflow-y-auto border-t border-line px-5 py-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink3">Recent broadcasts</h3>
          {history.length === 0 ? (
            <p className="text-sm text-ink3">No broadcasts sent yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((b) => (
                <li key={b.id} className="rounded-lg bg-card2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{b.title}</span>
                    <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink3">
                      {b.targetType === "USER" ? `→ ${b.user?.username ?? b.userId ?? "user"}` : "ALL"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink2">{b.message}</p>
                  <p className="mt-1 text-[10px] text-ink3">{new Date(b.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
