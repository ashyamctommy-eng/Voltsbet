"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconCoins, IconCheck } from "@/components/icons";

type AdminCurrency = {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  rate: string;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
};

/** Common operating currencies surfaced as one-tap options. */
const QUICK_PICKS = ["KES", "TZS", "UGX", "USD", "EUR", "GHS"];

/**
 * Platform-wide default operating currency. Stored in the system settings
 * table (`currency.default`) and mirrored onto the Currency table's
 * `isDefault` flag so Admin → Currencies shows the same DEFAULT badge.
 * The frontend formats every display amount (betslip payouts, stakes,
 * balances) with this currency.
 */
export default function AdminDefaultCurrency() {
  const { push } = useToast();
  const [currencies, setCurrencies] = useState<AdminCurrency[]>([]);
  const [current, setCurrent] = useState<string>("KES");
  const [pick, setPick] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ currencies: AdminCurrency[] }>("/api/admin/currencies").then((r) => {
      if (r.ok) setCurrencies(r.data.currencies);
    });
    apiFetch<{ settings: Record<string, string> }>("/api/admin/settings").then((r) => {
      if (r.ok) {
        const v = r.data.settings["currency.default"];
        if (v) {
          setCurrent(v);
          setPick(v);
        }
      }
    });
  }, []);

  const active = useMemo(() => currencies.filter((c) => c.active), [currencies]);
  const known = useMemo(() => new Set(active.map((c) => c.code)), [active]);
  const selected = active.find((c) => c.code === pick);

  async function save() {
    if (!pick) return push("error", "Choose a currency first.");
    if (!known.has(pick)) return push("error", `${pick} isn't in your currency table yet — add it in Admin → Currencies first.`);
    if (pick === current) return push("info", "That's already the default.");
    setSaving(true);
    // 1) persist the platform setting (source of truth for the frontend)
    const s = await apiFetch("/api/admin/settings", { method: "PUT", body: { "currency.default": pick } });
    const sErr = s.ok ? "" : s.error.message;
    // 2) mirror onto the Currency table so the DEFAULT badge stays consistent
    const c = await apiFetch(`/api/admin/currencies/${pick}`, { method: "PATCH", body: { isDefault: true } });
    const cErr = c.ok ? "" : c.error.message;
    setSaving(false);
    if (s.ok && c.ok) {
      setCurrent(pick);
      push("success", `Default currency set to ${pick} — the whole site now displays ${pick}.`);
    } else {
      push("error", sErr || cErr || "Failed to save.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Default Currency</h2>
        <p className="mt-1 text-sm text-ink2">
          The platform&apos;s primary operating currency. Every display amount across the frontend —
          betslip payouts, odds stakes, wallet balances — is formatted with this currency&apos;s ISO code
          (e.g. <b className="text-ink">Payout KES 3.05</b>). Per-user display preferences still apply on
          account pages.
        </p>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <span className="label mb-0 !p-0">Currently active</span>
          <span className="flex items-center gap-2 rounded-full bg-brand/15 px-3 py-1 text-sm font-bold text-brand">
            <IconCoins className="h-4 w-4" />
            {current}
          </span>
        </div>

        <div className="mt-5">
          <span className="label">Quick picks</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_PICKS.map((code) => {
              const isKnown = known.has(code);
              const isPick = pick === code;
              return (
                <button
                  key={code}
                  type="button"
                  disabled={!isKnown}
                  onClick={() => setPick(code)}
                  className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                    isPick
                      ? "border-brand bg-brand/15 text-brand"
                      : isKnown
                        ? "border-line2 text-ink2 hover:border-brand/60 hover:text-ink"
                        : "cursor-not-allowed border-line text-ink3 opacity-50"
                  }`}
                  title={isKnown ? active.find((c) => c.code === code)?.name : "Add this currency in Admin → Currencies first"}
                >
                  {code}
                  {isPick && <IconCheck className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-ink3">Greyed-out codes aren&apos;t in your currency table yet — add them under Admin → Currencies.</p>
        </div>

        <div className="mt-5">
          <span className="label">Or choose from all active currencies</span>
          <select
            className="input mt-2 w-full sm:max-w-sm"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label="Default currency"
          >
            <option value="" disabled>Select a currency…</option>
            {active.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={!pick || saving} onClick={save}>
            {saving ? "Saving…" : pick === current && pick ? "Already default" : `Set ${pick || "…"} as default`}
          </button>
          {selected && (
            <span className="text-sm text-ink2">
              Payout preview: <b className="text-green-400">{pick} 3.05</b>
            </span>
          )}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-bold">How it works</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink2">
          <li>Stored in system settings as <code className="rounded bg-card2 px-1">currency.default</code> (default <b>KES</b>).</li>
          <li>Exposed to the public API at <code className="rounded bg-card2 px-1">/api/public/currencies</code> and consumed by the frontend&apos;s currency provider.</li>
          <li>Mirrored onto the <code className="rounded bg-card2 px-1">Currency.isDefault</code> flag — Admin → Currencies shows the same DEFAULT badge.</li>
          <li>Wallet values are stored per-user in their own currency; this setting controls how display surfaces (betslip, balances) are labeled site-wide.</li>
        </ul>
      </div>
    </div>
  );
}
