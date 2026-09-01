"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type Sport = { id: string; name: string };
type Competition = { id: string; name: string; sportId: string };

export default function NewGamePage() {
  const router = useRouter();
  const { push } = useToast();
  const [sports, setSports] = useState<Sport[]>([]);
  const [comps, setComps] = useState<Competition[]>([]);
  const [form, setForm] = useState({
    sportId: "", competitionId: "", homeName: "", awayName: "",
    homeLogo: "", awayLogo: "", startAt: "", status: "SCHEDULED", featured: false, description: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ sports: Sport[] }>("/api/admin/sports").then((r) => {
      if (r.ok) {
        setSports(r.data.sports);
        if (r.data.sports[0]) setForm((f) => ({ ...f, sportId: r.data.sports[0].id }));
      }
    });
  }, []);

  useEffect(() => {
    if (!form.sportId) return;
    apiFetch<{ competitions: Competition[] }>(`/api/admin/competitions?sportId=${form.sportId}`).then((r) => {
      if (r.ok) setComps(r.data.competitions);
    });
  }, [form.sportId]);

  const defaultDate = () => {
    const d = new Date(Date.now() + 86400_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch<{ game: { id: string } }>("/api/admin/games", { method: "POST", body: { ...form, startAt: form.startAt || defaultDate() } });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Game created — add markets next.");
    router.push(`/admin/games/${res.data.game.id}`);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-lg font-bold">Add Manual Game</h2>
      <form onSubmit={submit} className="card grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <label className="label">Sport *</label>
          <select className="input" value={form.sportId} onChange={(e) => setForm({ ...form, sportId: e.target.value, competitionId: "" })} required>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Competition</label>
          <select className="input" value={form.competitionId} onChange={(e) => setForm({ ...form, competitionId: e.target.value })}>
            <option value="">— None / custom —</option>
            {comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Home team / player *</label>
          <input className="input" value={form.homeName} onChange={(e) => setForm({ ...form, homeName: e.target.value })} required />
        </div>
        <div>
          <label className="label">Away team / player *</label>
          <input className="input" value={form.awayName} onChange={(e) => setForm({ ...form, awayName: e.target.value })} required />
        </div>
        <div>
          <label className="label">Home logo URL</label>
          <input className="input" value={form.homeLogo} onChange={(e) => setForm({ ...form, homeLogo: e.target.value })} placeholder="https://…" />
        </div>
        <div>
          <label className="label">Away logo URL</label>
          <input className="input" value={form.awayLogo} onChange={(e) => setForm({ ...form, awayLogo: e.target.value })} placeholder="https://…" />
        </div>
        <div>
          <label className="label">Date & time *</label>
          <input className="input" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} required />
        </div>
        <div>
          <label className="label">Initial status</label>
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="SCHEDULED">Scheduled</option>
            <option value="LIVE">Live</option>
            <option value="POSTPONED">Postponed</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description / custom competition name</label>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink2 sm:col-span-2">
          <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="h-4 w-4 accent-[var(--vb-primary)]" />
          Featured match (show on homepage)
        </label>
        <div className="sm:col-span-2">
          <button className="btn btn-primary w-full py-3" disabled={loading}>
            {loading ? "Creating…" : "Create Game"}
          </button>
        </div>
      </form>
    </div>
  );
}
