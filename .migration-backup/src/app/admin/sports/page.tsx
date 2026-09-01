"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type Sport = { id: string; name: string; slug: string; icon: string; sortOrder: number; active: boolean; isPopular: boolean; _count?: { games: number } };

export default function AdminSports() {
  const { push } = useToast();
  const [sports, setSports] = useState<Sport[]>([]);
  const [editing, setEditing] = useState<Sport | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", icon: "", isPopular: false, active: true, sortOrder: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ sports: Sport[] }>("/api/admin/sports").then((r) => r.ok && setSports(r.data.sports));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const body = { ...form, sortOrder: Number(form.sortOrder) };
    const res = editing
      ? await apiFetch(`/api/admin/sports/${editing.id}`, { method: "PATCH", body })
      : await apiFetch("/api/admin/sports", { method: "POST", body });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", editing ? "Sport updated" : "Sport created");
    setEditing(null);
    setForm({ name: "", slug: "", icon: "", isPopular: false, active: true, sortOrder: 0 });
    const r = await apiFetch<{ sports: Sport[] }>("/api/admin/sports");
    if (r.ok) setSports(r.data.sports);
  }

  async function toggleActive(s: Sport) {
    const res = await apiFetch(`/api/admin/sports/${s.id}`, { method: "PATCH", body: { active: !s.active } });
    if (!res.ok) return push("error", res.error.message);
    push("success", `${s.name} ${s.active ? "disabled" : "enabled"}`);
    const r = await apiFetch<{ sports: Sport[] }>("/api/admin/sports");
    if (r.ok) setSports(r.data.sports);
  }

  async function remove(s: Sport) {
    if (!confirm(`Delete sport "${s.name}"?`)) return;
    const res = await apiFetch(`/api/admin/sports/${s.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Sport deleted");
    const r = await apiFetch<{ sports: Sport[] }>("/api/admin/sports");
    if (r.ok) setSports(r.data.sports);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">Sports</h2>

      <form onSubmit={save} className="card grid gap-3 p-5 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Darts" required />
        </div>
        <div>
          <label className="label">Slug</label>
          <input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="darts" required />
        </div>
        <div>
          <label className="label">Icon (emoji)</label>
          <input className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="Legacy emoji (vector icons auto-derived from slug)" />
        </div>
        <div>
          <label className="label">Sort order</label>
          <input className="input" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs text-ink2">
            <input type="checkbox" checked={form.isPopular} onChange={(e) => setForm({ ...form, isPopular: e.target.checked })} />
            Popular
          </label>
          <button className="btn btn-primary flex-1" disabled={loading}>{editing ? "Save" : "Add Sport"}</button>
        </div>
      </form>

      <div className="card divide-y divide-line">
        {sports.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-8 text-center text-xl">{s.icon}</span>
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{s.name}</span>
              <span className="ml-2 text-xs text-ink3">/{s.slug} · {s._count?.games ?? 0} games</span>
              {!s.active && <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">DISABLED</span>}
              {s.isPopular && <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">POPULAR</span>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(s); setForm({ name: s.name, slug: s.slug, icon: s.icon ?? "", isPopular: s.isPopular, active: s.active, sortOrder: s.sortOrder }); }}>Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(s)}>{s.active ? "Disable" : "Enable"}</button>
              <button className="btn btn-danger btn-sm" onClick={() => remove(s)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
