"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconSend, IconPlug, IconCheck, IconX } from "@/components/icons";

type ApiConfig = {
  provider: string;
  keySet: boolean;
  keyMasked: string;
  regions: string;
  note: string;
};

type TestResult = {
  ok: boolean;
  status?: number;
  quota?: { used?: string; remaining?: string };
  activeSoccerLeagues?: number;
  markets?: string[];
  marketSample?: string | null;
  note?: string;
  error?: string;
};

/** Provider status + live test — The Odds API (v4) is the single provider. */
export default function AdminApiSettings() {
  const { push } = useToast();
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    apiFetch<{ config: ApiConfig }>("/api/admin/config/api").then((res) => {
      if (!res.ok) return;
      setConfig(res.data.config);
    });
  }, []);

  async function runTest() {
    setTesting(true);
    setTest(null);
    const res = await apiFetch<TestResult>("/api/admin/config/api/test", { method: "POST", body: {} });
    setTesting(false);
    if (!res.ok) {
      setTest({ ok: false, error: res.error.message });
      return push("error", res.error.message);
    }
    setTest(res.data);
    if (res.data.ok) push("success", "The Odds API connection verified");
    else push("error", res.data.error ?? "Connection test failed");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/15 text-brand">
            <IconPlug className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-extrabold">API Settings — The Odds API (v4)</h1>
            <p className="text-sm text-ink2">
              Single sports data provider: pre-match odds, live scores and settlement all run on the-odds-api.com.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-xl border border-line bg-card2 px-4 py-3">
            <span className="font-semibold text-ink2">Provider</span>
            <span className="font-mono font-bold text-brand">{config?.provider ?? "…"}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-card2 px-4 py-3">
            <span className="font-semibold text-ink2">API key (env ODDS_API_KEY)</span>
            <span className={`flex items-center gap-1.5 font-mono text-xs ${config?.keySet ? "text-green-500" : "text-amber-400"}`}>
              {config?.keySet ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" /> {config.keyMasked}
                </>
              ) : (
                <>
                  <IconX className="h-3.5 w-3.5" /> not set
                </>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-card2 px-4 py-3">
            <span className="font-semibold text-ink2">Bookmaker regions</span>
            <span className="font-mono text-xs">{config?.regions ?? "us"}</span>
          </div>
          <p className="rounded-xl bg-brand/5 px-4 py-3 text-xs leading-relaxed text-ink2">{config?.note}</p>
        </div>

        <button className="btn btn-primary mt-5" disabled={testing || !config?.keySet} onClick={runTest}>
          <IconSend className="h-4 w-4" />
          {testing ? "Testing…" : "Test connection"}
        </button>

        {test && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${test.ok ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}>
            <div className="flex items-center gap-2 font-bold">
              {test.ok ? <IconCheck className="h-4 w-4 text-green-500" /> : <IconX className="h-4 w-4 text-red-500" />}
              {test.ok ? "Connection OK" : "Connection failed"}
              {test.quota?.remaining != null && (
                <span className="ml-auto font-mono text-xs font-semibold text-ink2">
                  quota remaining: {test.quota.remaining} / used: {test.quota.used}
                </span>
              )}
            </div>
            {test.ok && (
              <div className="mt-2 space-y-1 text-xs text-ink2">
                {test.activeSoccerLeagues != null && <p>Active soccer leagues available: {test.activeSoccerLeagues}</p>}
                {test.markets && test.markets.length > 0 && (
                  <p>
                    Markets returned by the expanded request: <span className="font-mono">{test.markets.join(", ")}</span>
                  </p>
                )}
                {test.marketSample && <p>Sample event: {test.marketSample}</p>}
                {test.note && <p>{test.note}</p>}
              </div>
            )}
            {!test.ok && <p className="mt-1 text-xs text-ink2">{test.error ?? test.note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
