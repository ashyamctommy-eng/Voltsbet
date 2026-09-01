"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type Language = { code: string; name: string; isDefault: boolean; active: boolean; sortOrder: number };

export default function AdminLanguages() {
  const { push } = useToast();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [form, setForm] = useState({ code: "", name: "" });
  const [editing, setEditing] = useState<Language | null>(null);
  const [translations, setTranslations] = useState<{ key: string; value: string }[]>([]);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await apiFetch<{ languages: Language[] }>("/api/admin/languages");
    if (r.ok) setLanguages(r.data.languages);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch("/api/admin/languages", { method: "POST", body: form });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Language added");
    setForm({ code: "", name: "" });
    load();
  }

  async function openTranslations(l: Language) {
    setEditing(l);
    const r = await apiFetch<{ translations: { key: string; value: string }[] }>(`/api/public/translations?lang=${l.code}`);
    setTranslations(r.ok ? r.data.translations : []);
  }

  async function saveTranslations() {
    const res = await apiFetch("/api/admin/languages", {
      method: "PATCH",
      body: { langCode: editing!.code, translations },
    });
    if (!res.ok) return push("error", res.error.message);
    setSaveMsg(`Saved ${res.data.message ?? ""}`);
    setTimeout(() => setSaveMsg(""), 3000);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">Languages</h2>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-5">
        <div><label className="label">Code</label><input className="input w-28" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} placeholder="fr" required /></div>
        <div><label className="label">Name</label><input className="input w-48" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Français" required /></div>
        <button className="btn btn-primary">Add Language</button>
      </form>

      <div className="card divide-y divide-line">
        {languages.map((l) => (
          <div key={l.code} className="flex items-center gap-3 px-4 py-3">
            <span className="w-16 font-bold">{l.code}</span>
            <span className="flex-1 text-sm text-ink2">{l.name}</span>
            {l.isDefault && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">DEFAULT</span>}
            {!l.active && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">DISABLED</span>}
            <button className="btn btn-ghost btn-sm" onClick={() => openTranslations(l)}>Translations</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="fade-in absolute inset-0 bg-black/70" onClick={() => setEditing(null)} />
          <div className="fade-in card flex max-h-[85vh] w-full max-w-2xl flex-col p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Translations — {editing.name} ({editing.code})</h3>
              <button className="text-ink3 hover:text-ink" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
              {translations.length === 0 && <p className="text-sm text-ink3">No translations yet — add keys below (e.g. nav.home).</p>}
              {translations.map((t, i) => (
                <div key={`${t.key}-${i}`} className="grid grid-cols-[180px_1fr] gap-2">
                  <input className="input py-1.5 text-xs font-mono" value={t.key} readOnly />
                  <input className="input py-1.5 text-xs" value={t.value} onChange={(e) => setTranslations((ts) => ts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setTranslations((ts) => [...ts, { key: "", value: "" }])}>+ Key</button>
              <button className="btn btn-primary btn-sm ml-auto" onClick={saveTranslations}>Save translations</button>
              {saveMsg && <span className="text-xs text-green-400">{saveMsg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
