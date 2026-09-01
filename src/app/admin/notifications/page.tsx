"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

export default function AdminNotifications() {
  const { push } = useToast();
  const [form, setForm] = useState({ title: "", message: "", audience: "ALL", userIds: "" });
  const [loading, setLoading] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch<{ message: string }>("/api/admin/notifications", {
      method: "POST",
      body: {
        title: form.title,
        message: form.message,
        audience: form.audience,
        userIds: form.userIds.split(",").map((s) => s.trim()).filter(Boolean),
      },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message ?? "Announcement sent");
    setForm({ title: "", message: "", audience: "ALL", userIds: "" });
  }

  return (
    <form onSubmit={send} className="max-w-2xl space-y-5">
      <h2 className="text-lg font-bold">Send Announcement</h2>
      <div className="card space-y-4 p-6">
        <div>
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Maintenance notice" required />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea className="input" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
        </div>
        <div>
          <label className="label">Audience</label>
          <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
            <option value="ALL">All users (broadcast)</option>
            <option value="ACTIVE">Active users only</option>
            <option value="USER_IDS">Specific user IDs</option>
          </select>
        </div>
        {form.audience === "USER_IDS" && (
          <div>
            <label className="label">User IDs (comma-separated)</label>
            <input className="input" value={form.userIds} onChange={(e) => setForm({ ...form, userIds: e.target.value })} placeholder="cu_xxx, cu_yyy" />
          </div>
        )}
        <button className="btn btn-primary" disabled={loading}>{loading ? "Sending…" : "Send Announcement"}</button>
      </div>
      <p className="text-xs text-ink3">Broadcasts appear to all users in their notification center. Targeted sends respect user statuses.</p>
    </form>
  );
}
