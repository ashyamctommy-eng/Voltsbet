"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type Currency = { code: string; name: string; symbol: string; decimals: number; rate: string; isDefault: boolean; active: boolean; sortOrder: number };

export default function AdminCurrencies() {
  const { push } = useToast();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [form, setForm] = useState({ code: "", name: "", symbol: "", decimals: 2, rate: "" });

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await apiFetch<{ currencies: Currency[] }>("/api/admin/currencies");
    if (r.ok) setCurrencies(r.data.currencies);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch("/api/admin/currencies", {
      method: "POST",
      body: { ...form, decimals: Number(form.decimals), rate: Number(form.rate) },
    });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Currency added");
    setForm({ code: "", name: "", symbol: "", decimals: 2, rate: "" });
    load();
  }

  async function patch(c: Currency, body: Record<string, unknown>) {
    const res = await apiFetch(`/api/admin/currencies/${c.code}`, { method: "PATCH", body });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Currency updated");
    load();
  }

  const [syncing, setSyncing] = useState(false);
  async function syncRates() {
    setSyncing(true);
    const res = await apiFetch<{ fxUpdated: number; cryptoRates: Record<string, number> | null }>("/api/admin/currencies/sync", { method: "POST" });
    setSyncing(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", `Rates synced — ${res.data.fxUpdated} fiat rate(s) updated${res.data.cryptoRates ? " + crypto" : ""}`);
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Currencies</h2>
        <button className="btn btn-ghost btn-sm" onClick={syncRates} disabled={syncing}>
          {syncing ? "Syncing…" : "⟳ Sync market rates"}
        </button>
      </div>

      <form onSubmit={create} className="card grid gap-3 p-5 sm:grid-cols-6">
        <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="KES" required /></div>
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Kenyan Shilling" required /></div>
        <div><label className="label">Symbol</label><input className="input" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="KSh" required /></div>
        <div><label className="label">Decimals</label><input className="input" type="number" value={form.decimals} onChange={(e) => setForm({ ...form, decimals: Number(e.target.value) })} /></div>
        <div><label className="label">Rate (per base)</label><input className="input" type="number" step="any" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="1.0" required /></div>
        <div className="flex items-end"><button className="btn btn-primary w-full">Add</button></div>
      </form>

      <div className="card divide-y divide-line">
        {currencies.map((c) => (
          <div key={c.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <span className="font-bold">{c.code}</span>
              <span className="ml-2 text-sm text-ink2">{c.name} ({c.symbol})</span>
              {c.isDefault && <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">DEFAULT</span>}
              {!c.active && <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">DISABLED</span>}
            </div>
            <span className="text-xs text-ink3">rate {c.rate} · {c.decimals}dp</span>
            <input
              className="input w-28 py-1.5 text-xs"
              defaultValue={c.rate}
              key={`${c.code}-${c.rate}`}
              onBlur={(e) => { const v = parseFloat(e.target.value); if (v > 0 && v !== Number(c.rate)) patch(c, { rate: v }); }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => patch(c, { isDefault: true })}>Set default</button>
            <button className="btn btn-ghost btn-sm" onClick={() => patch(c, { active: !c.active })}>{c.active ? "Disable" : "Enable"}</button>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink3">Rate = base-currency units per 1 unit of this currency (e.g. 1 USD = 129 KES → rate 129). The default currency has rate 1. Rates auto-sync from the market (cron /api/cron/rates or this button) — manual edits are overwritten by the next sync.</p>
    </div>
  );
}
