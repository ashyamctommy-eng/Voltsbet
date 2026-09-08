"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconSend, IconPlug, IconCheck, IconX, IconSearch, IconCopy } from "@/components/icons";

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

type SyncLeaguesData = {
  configured: string[];
  catalog: { key: string; name: string }[] | null;
  note: string;
};

/** Accept one key per line, comma separated, or a JSON array. */
function parseLeagues(v: string): string[] {
  const raw = v.trim();
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return [...new Set(arr.filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => x && !x.startsWith("#")))];
    } catch { /* fall through */ }
  }
  return [...new Set(raw.split(/[\n,]+/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")))];
}

/** Provider status + live test — The Odds API (v4) is the single provider. */
export default function AdminApiSettings() {
  const { push } = useToast();
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  // League sync whitelist manager
  const [syncData, setSyncData] = useState<SyncLeaguesData | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [search, setSearch] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    apiFetch<{ config: ApiConfig }>("/api/admin/config/api").then((res) => {
      if (!res.ok) return;
      setConfig(res.data.config);
    });
  }, []);

  useEffect(() => {
    apiFetch<SyncLeaguesData>("/api/admin/sync-leagues").then((res) => {
      if (!res.ok) return;
      setSyncData(res.data);
      setDraft(res.data.configured.join("\n"));
    });
  }, []);

  async function saveLeagues() {
    const list = parseLeagues(draft);
    setSaving(true);
    setSavedMsg("");
    const res = await apiFetch<{ saved: number; mode: string; message: string }>("/api/admin/sync-leagues", {
      method: "PUT",
      body: { leagues: list },
    });
    setSaving(false);
    if (!res.ok) return push("error", res.error.message);
    setSyncData((d) => (d ? { ...d, configured: list } : d));
    setSavedMsg(res.data.message);
    push("success", list.length ? `Whitelist saved — ${list.length} league(s) will sync` : "Whitelist cleared — full catalog sync restored");
  }

  function toggleKey(key: string) {
    const cur = parseLeagues(draft);
    setDraft(cur.includes(key) ? cur.filter((k) => k !== key).join("\n") : [...cur, key].join("\n"));
    setSavedMsg("");
  }

  async function copyAllKeys() {
    if (!syncData?.catalog?.length) return;
    try {
      await navigator.clipboard.writeText(syncData.catalog.map((c) => c.key).join("\n"));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      push("info", "Browser blocked clipboard — select the list text manually.");
    }
  }

  const catalogFiltered = syncData?.catalog?.filter(
    (c) => c.key.toLowerCase().includes(search.toLowerCase()) || c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const inDraft = (key: string) => parseLeagues(draft).includes(key);
  const whitelistOn = parseLeagues(draft).length > 0;

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

      {/* ── League sync whitelist ─────────────────────────────── */}
      <div className="card p-6">
        <h1 className="text-lg font-extrabold">League sync — credit whitelist</h1>
        <p className="mt-1 text-sm text-ink2">
          The odds sync costs <b>1 request per league per run</b>. Leave the list empty to sync every
          bettable league (catalog order, capped by <code className="font-mono text-xs">ODDS_API_FEED_MAX_LEAGUES</code>),
          or add only the leagues you offer — <b>nothing outside the list is ever queried</b>, so no credits
          are wasted on leagues you don&apos;t care about.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Left: editor */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label !mb-0">Leagues to sync (one key per line, in priority order)</label>
              {whitelistOn && (
                <span className="text-[11px] font-bold text-brand">
                  {parseLeagues(draft).length} league(s) ≈ {parseLeagues(draft).length} requests/run
                </span>
              )}
            </div>
            <textarea
              className="input min-h-[200px] w-full resize-y font-mono text-xs !leading-5"
              placeholder={"soccer_epl\nsoccer_uefa_champs_league\n# a # prefix ignores a line"}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setSavedMsg(""); }}
            />
            <p className="mt-1 text-[11px] text-ink3">
              Empty = sync <b>all</b> bettable leagues. Keys that are out of season or futures-only are kept
              but skipped until the API lists them again. Lines starting with <code className="font-mono">#</code> are ignored.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={saveLeagues}>
                {saving ? "Saving…" : whitelistOn ? "Save whitelist" : "Sync all (clear)"}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!whitelistOn || saving} onClick={() => { setDraft(""); setSavedMsg(""); }}>
                Clear list
              </button>
              {savedMsg && <span className="text-xs font-semibold text-green-500">{savedMsg}</span>}
            </div>

            <div className="mt-4 rounded-xl bg-brand/5 p-3 text-xs leading-relaxed text-ink2">
              <b>Pro tip (football-first):</b> click the <b>＋ soccer (N)</b> chip below to add every
              in-season football league in one click — those keys are queried first, in the order you add them.
            </div>
          </div>

          {/* Right: live catalog browser */}
          <div className="flex min-h-[300px] flex-col rounded-xl border border-line bg-card p-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink3" />
                <input
                  className="input !py-1.5 !pl-8 text-xs"
                  placeholder={`Search ${syncData?.catalog?.length ?? 0} leagues…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="btn btn-ghost btn-sm shrink-0" onClick={copyAllKeys} disabled={!syncData?.catalog?.length}>
                <IconCopy className="h-3.5 w-3.5" /> {copiedAll ? "Copied!" : "Copy all"}
              </button>
            </div>

            {syncData?.catalog?.length ? (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["soccer_", "basketball_", "tennis_", "icehockey_", "americanfootball_"].map((prefix) => {
                    const matches = syncData.catalog!.filter((c) => c.key.startsWith(prefix));
                    const anyOutside = matches.some((c) => !inDraft(c.key));
                    return (
                      <button
                        key={prefix}
                        type="button"
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                          matches.length && anyOutside ? "bg-brand/15 text-brand hover:bg-brand/25" : "bg-card2 text-ink3"
                        }`}
                        onClick={() => {
                          const cur = parseLeagues(draft);
                          const add = matches.filter((c) => !cur.includes(c.key)).map((c) => c.key);
                          setDraft(add.length ? [...cur, ...add].join("\n") : cur.filter((k) => !matches.some((m) => m.key === k)).join("\n"));
                          setSavedMsg("");
                        }}
                      >
                        {anyOutside ? "＋ " : "－ "}
                        {prefix.replace("_", "")} ({matches.length})
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[10px] text-ink3">Click a chip to add/remove a whole sport. Click a row to toggle one league.</p>
                <ul className="no-scrollbar mt-1.5 max-h-64 flex-1 divide-y divide-line/60 overflow-y-auto">
                  {catalogFiltered?.map((c) => {
                    const added = inDraft(c.key);
                    return (
                      <li key={c.key}>
                        <button
                          type="button"
                          onClick={() => toggleKey(c.key)}
                          className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors ${added ? "bg-brand/10" : "hover:bg-hover-tint"}`}
                        >
                          <span className={`w-6 shrink-0 text-center text-xs font-black ${added ? "text-brand" : "text-ink3"}`}>{added ? "✓" : "＋"}</span>
                          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{c.key}</code>
                          <span className="shrink-0 truncate text-[10px] text-ink3">{c.name}</span>
                        </button>
                      </li>
                    );
                  })}
                  {catalogFiltered && catalogFiltered.length === 0 && (
                    <li className="px-2 py-6 text-center text-xs text-ink3">No leagues match “{search}”.</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-xs text-amber-400">{syncData?.note ?? "Loading catalog…"}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
