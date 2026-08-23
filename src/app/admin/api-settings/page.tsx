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
  primaryProvider: string;
  prematchProvider: string;
  liveProvider: string;
};

const PROVIDER_OPTIONS = ["", "the-odds-api", "api-football"];
const PROVIDER_LABELS: Record<string, string> = {
  "the-odds-api": "the-odds-api (primary)",
  "api-football": "api-football",
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
  const [prematchRole, setPrematchRole] = useState("");
  const [liveRole, setLiveRole] = useState("");
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
      setPrematchRole(c.prematchProvider ?? "");
      setLiveRole(c.liveProvider ?? "");
      if (!c.rapidKeySet) setKey("");
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await apiFetch<{ message: string; primary: boolean }>("/api/admin/config/api", {
      method: "POST",
      body: { rapidKey: key, rapidHost: host, rapidBase: base, prematchProvider: prematchRole, liveProvider: liveRole },
    });
    setSaving(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    setKey("");
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

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Live engine designation */}
      <div className="flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
        <IconPlug className="h-5 w-5 text-sky-400" />
        <div className="text-sm">
          <p className="font-extrabold text-sky-400">LIVE ENGINE: BetsAPI (bet365) — /live in-play scores</p>
          <p className="text-xs text-ink3">betsapi2.p.rapidapi.com · v3/bet365/inplay · pre-match odds come from the sync providers (Admin → Settings → Odds & Risk)</p>
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

        {/* Per-provider roles — which source feeds pre-match odds vs live scores */}
        <div className="rounded-lg border border-line bg-card2/40 p-4">
          <p className="text-sm font-bold">Provider roles</p>
          <p className="mt-0.5 text-xs text-ink3">
            Pre-match fixtures/odds and live scores can come from different sync providers.
            Empty = follow the primary provider (<b className="text-ink2">{PROVIDER_LABELS[config?.primaryProvider ?? ""] ?? config?.primaryProvider ?? "the-odds-api"}</b>).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Pre-match provider (role)</label>
              <select className="input" value={prematchRole} onChange={(e) => setPrematchRole(e.target.value)}>
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o === "" ? "— Primary (default) —" : PROVIDER_LABELS[o]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Live provider (role)</label>
              <select className="input" value={liveRole} onChange={(e) => setLiveRole(e.target.value)}>
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o === "" ? "— Primary (default) —" : PROVIDER_LABELS[o]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={testConnection} disabled={testing} className="btn border border-line bg-hover-tint font-semibold hover:bg-white/10">
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
