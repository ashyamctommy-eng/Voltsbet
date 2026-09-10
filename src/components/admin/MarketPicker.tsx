"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MARKET_GROUPS, SOCCER_MARKETS, type CatalogMarket } from "@/lib/market-catalog";

/**
 * Tap-to-select market catalog for the Soccer Market Engine panel — same
 * interaction model as the league sync whitelist: search, grouped chips,
 * tap to select/deselect, with the selected count and preset/clear actions.
 */
export default function MarketPicker({
  label,
  hint,
  selected,
  onChange,
  recommended,
  envTag,
}: {
  label: string;
  hint?: string;
  /** Comma-separated market keys currently selected. */
  selected: string;
  onChange: (next: string) => void;
  /** One-click preset (e.g. the recommended tier menu). */
  recommended?: string[];
  envTag?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const chosen = useMemo(() => selected.split(",").map((x) => x.trim()).filter(Boolean), [selected]);

  const toggle = (key: string) =>
    onChange(chosen.includes(key) ? chosen.filter((k) => k !== key).join(",") : [...chosen, key].join(","));

  const term = q.trim().toLowerCase();
  const filtered = useMemo(
    () => SOCCER_MARKETS.filter((m) => !term || m.key.includes(term) || m.name.toLowerCase().includes(term)),
    [term],
  );

  const chip = (m: CatalogMarket) => {
    const active = chosen.includes(m.key);
    return (
      <button
        key={m.key}
        type="button"
        onClick={() => toggle(m.key)}
        title={`${m.name} — ${m.key}${m.listSupported ? " (list endpoint)" : " (per event)"}`}
        aria-pressed={active}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 ${
          active ? "border-brand bg-brand/15 text-brand" : "border-line bg-card2 text-ink2 hover:text-ink"
        }`}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${active ? "bg-brand" : "bg-line"}`} />
        {m.name}
        <span className="font-mono text-[10px] opacity-60">{m.key}</span>
        {m.settle === "manual" && (
          <span
            className="rounded bg-amber-500/15 px-1 text-[9px] font-black uppercase text-amber-600 dark:text-amber-400"
            title="No result feed for this market — outcomes are settled by hand in Admin → Ops → Settlement Review."
          >
            manual
          </span>
        )}
        {m.settle === "auto-ht" && (
          <span
            className="rounded bg-sky-500/15 px-1 text-[9px] font-black uppercase text-sky-600 dark:text-sky-400"
            title="Auto-settles once the half-time score is entered (Admin → Games) — the API feed has no half-time scores."
          >
            needs HT
          </span>
        )}
      </button>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="label mb-0">{label}</label>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-ink3">
            {chosen.length} selected
          </span>
          {recommended && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(recommended.join(","))}>
              Recommended
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")} disabled={!chosen.length}>
            Clear
          </button>
        </div>
      </div>

      <input
        className="input mt-2"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search markets — e.g. corners, btts, total"
      />

      <div className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-xl border border-line bg-card2/40 p-3">
        {MARKET_GROUPS.map((g) => {
          const items = filtered.filter((m) => m.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id}>
              <div className="text-[11px] font-black uppercase tracking-wide text-ink3">
                {g.label} <span className="font-semibold normal-case opacity-70">— {g.hint}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{items.map(chip)}</div>
            </div>
          );
        })}
        {!filtered.length && <p className="text-xs text-ink3">No market matches “{q}”.</p>}
      </div>

      {hint && <p className="mt-1 text-[11px] text-ink3">{hint}</p>}
      {envTag}
    </div>
  );
}
