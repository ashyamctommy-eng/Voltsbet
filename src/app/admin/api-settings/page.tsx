"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconSend, IconPlug, IconCheck, IconX } from "@/components/icons";

type ApiConfig = {
  rapidKey: string;
  rapidKeySet: boolean;
  rapidHost: string;
  rapidBase: string;
  primary: boolean;
};

type TestResult = {
  ok: boolean;
  status?: number;
  events?: number;
  sample?: string | null;
  prematchMarkets?: string[];
  prematchError?: string | null;
  error?: string;
};

export default function AdminApiSettings() {
  const { push } = useToast();
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [key, setKey] = useState("");
  const [host, setHost] = useState("betsapi2.p.rapidapi.com");
  const [base, setBase] = useState("https://betsapi2.p.rapidapi.com");
  const [primary, setPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    apiFetch<{ config: ApiConfig }>("/api/admin/config/api").then((res) => {
      if (!res.ok) return;
      const c = res.data.config;
      setConfig(c);
      setHost(c.rapidHost);
      setBase(c.rapidBase);
      setPrimary(c.primary);
      if (!c.rapidKeySet) setKey("");
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await apiFetch<{ message: string; primary: boolean }>("/api/admin/config/api", {
      method: "POST",
      body: { rapidKey: key, rapidHost: host, rapidBase: base, primary },
    });
    setSaving(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    setKey("");
    setPrimary(res.data.primary);
    const refetch = await apiFetch<{ config: ApiConfig }>("/api/admin/config/api");
    if (refetch.ok) setConfig(refetch.data.config);
  }

  async function testConnection() {
    setTesting(true);
    setTest(null);
    const res = await apiFetch<TestResult>("/api/admin/config/api/test", {
      method: "POST",
      body: { rapidKey: key, rapidHost: host, rapidBase: base },
    });
    setTesting(false);
    if (!res.ok) {
      setTest({ ok: false, error: res.error.message });
      return push("error", res.error.message);
    }
    setTest(res.data);
    push(res.data.ok ? "success" : "error", res.data.ok ? `Connected — ${res.data.events} pre-match events` : "Connection failed");
  }

  const isPrimary = primary || config?.primary;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Active API designation */}
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
          isPrimary ? "border-green-500/40 bg-green-500/10" : "border-line bg-white/5"
        }`}
      >
        <IconPlug className={`h-5 w-5 ${isPrimary ? "text-green-400" : "text-ink3"}`} />
        <div className="text-sm">
          <p className={`font-extrabold ${isPrimary ? "text-green-400" : "text-ink2"}`}>
            {isPrimary ? "PRIMARY PROVIDER:" : "PROVIDER (not primary):"} Bet365 (via RapidAPI / BetsAPI)
          </p>
          <p className="text-xs text-ink3">betsapi2.p.rapidapi.com · v3/bet365/prematch · v3/bet365/inplay</p>
        </div>
      </div>

      <form onSubmit={save} className="card space-y-4 p-6">
        <h2 className="text-lg font-bold">API Credentials</h2>

        <div>
          <label className="label">X-RapidAPI-Key</label>
          <input
            type="password"
            className="input font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={config?.rapidKeySet ? "•••••••••••• (saved — leave blank to keep)" : "Your RapidAPI key"}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label">X-RapidAPI-Host</label>
          <input
            className="input font-mono"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="betsapi2.p.rapidapi.com"
          />
        </div>
        <div>
          <label className="label">Base Target URL</label>
          <input
            className="input font-mono"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://betsapi2.p.rapidapi.com"
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-card2 px-4 py-3">
          <span className="text-sm font-semibold">
            Set as primary provider
            <span className="block text-xs font-normal text-ink3">Switches the live odds engine to Bet365 (via RapidAPI)</span>
          </span>
          <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-white/10 transition-colors" style={{ background: primary ? "var(--vb-primary,#00e676)" : undefined }}>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
            />
            <span
              className="absolute h-5 w-5 rounded-full bg-white shadow transition-all"
              style={{ left: primary ? 22 : 2 }}
            />
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={testConnection} disabled={testing} className="btn border border-line bg-white/5 font-semibold hover:bg-white/10">
            {testing ? "Testing…" : "Test Primary Connection"}
          </button>
          <button className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            <IconSend className="h-4 w-4" />
            {saving ? "Saving…" : "Save API Settings"}
          </button>
        </div>

        {test && (
          <div
            className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
              test.ok ? "border border-green-500/40 bg-green-500/10 text-green-300" : "border border-red-500/40 bg-red-500/10 text-red-300"
            }`}
          >
            {test.ok ? <IconCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <IconX className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0">
              <p className="font-bold">
                {test.ok ? `Connected — ${test.events ?? 0} pre-match events` : "Connection failed"}
              </p>
              {test.ok && test.sample ? <p className="text-xs opacity-80">Sample: {test.sample}</p> : null}
              {test.ok && test.prematchMarkets && test.prematchMarkets.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-1">
                  {test.prematchMarkets.map((m) => (
                    <span key={m} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">
                      {m}
                    </span>
                  ))}
                </p>
              ) : null}
              {test.ok && test.prematchError ? (
                <p className="mt-1 break-all font-mono text-xs opacity-80">prematch: {test.prematchError}</p>
              ) : null}
              {!test.ok && test.error ? <p className="mt-0.5 break-all font-mono text-xs opacity-80">{test.error}</p> : null}
            </div>
          </div>
        )}
      </form>

      <p className="text-xs text-ink3">
        Pipeline: <span className="font-mono">/v1/bet365/upcoming</span> (fixture list) →{" "}
        <span className="font-mono">/v3/bet365/prematch?FI=</span> (bet365 odds per event — capped by
        <span className="font-mono"> BETSAPI_ODDS_EVENTS</span>, default 20) →{" "}
        <span className="font-mono">/v1/bet365/result?event_id=</span> (finished outcomes for settlement).
        Markets: full_time_result (1X2), double_chance, goals_over_under, both_teams_to_score, draw_no_bet —
        margin applied; missing prices render as “-”. Live: <span className="font-mono">/v3/bet365/inplay</span>.
        Keep sync runs modest — the BASIC RapidAPI plan is rate-limited per hour.
      </p>
    </div>
  );
}
