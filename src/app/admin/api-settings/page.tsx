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

type OddsConfig = {
  stored: {
    regions: string; rateLimitMs: number; eventBookmakers: string; markets: string[];
    feedMaxLeagues: number; eventMarketLimit: number; eventMarketLeagues: string[]; syncLeagues: string[];
  };
  env: Record<string, string | undefined>;
  quota: { used: number; remaining: number } | null;
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
  // Odds engine config + live quota (Admin → API Settings)
  const [odds, setOdds] = useState<OddsConfig | null>(null);
  const [fm, setFm] = useState({
    regions: "eu,us",
    rateLimitMs: "1100",
    bookmakers: "bovada,pinnacle",
    markets: "",
    feedMaxLeagues: "120",
    evLimit: "4",
    evLeagues: "",
  });
  const [savingOdds, setSavingOdds] = useState<"" | "ev" | "prefs">("");
  const [oddsMsg, setOddsMsg] = useState("");

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

  useEffect(() => {
    apiFetch<OddsConfig>("/api/admin/odds-config").then((r) => {
      if (!r.ok) return;
      setOdds(r.data);
      setFm({
        regions: r.data.stored.regions,
        rateLimitMs: String(r.data.stored.rateLimitMs),
        bookmakers: r.data.stored.eventBookmakers,
        markets: r.data.stored.markets.join(", "),
        feedMaxLeagues: String(r.data.stored.feedMaxLeagues),
        evLimit: String(r.data.stored.eventMarketLimit),
        evLeagues: r.data.stored.eventMarketLeagues.join(", "),
      });
    });
    const t = setInterval(() => {
      // Keep the quota read fresh (server caches 60s; the /v4/sports call is free).
      apiFetch<OddsConfig>("/api/admin/odds-config").then((r) => r.ok && setOdds(r.data));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const envTag = (key: keyof OddsConfig["env"]) =>
    odds?.env?.[key] ? (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400" title={`Railway env ${key} overrides this`}>
        env: {odds.env[key]}
      </span>
    ) : null;

  async function saveOdds(kind: "ev" | "prefs") {
    setSavingOdds(kind);
    setOddsMsg("");
    const body =
      kind === "ev"
        ? { eventMarketLimit: Number(fm.evLimit || 0), eventMarketLeagues: fm.evLeagues }
        : {
            regions: fm.regions,
            rateLimitMs: Number(fm.rateLimitMs || 1100),
            eventBookmakers: fm.bookmakers,
            markets: fm.markets,
            feedMaxLeagues: Number(fm.feedMaxLeagues || 120),
          };
    const res = await apiFetch<{ message: string }>("/api/admin/odds-config", { method: "PUT", body });
    setSavingOdds("");
    if (!res.ok) return push("error", res.error.message);
    setOddsMsg(res.data.message);
    push("success", res.data.message);
    const r = await apiFetch<OddsConfig>("/api/admin/odds-config");
    if (r.ok) setOdds(r.data);
  }

  // ≈ runs left on the current balance for the LIST pass only.
  const runsLeft = (() => {
    const q = odds?.quota;
    if (!q || !odds) return null;
    const regionsCount = fm.regions.includes(",") ? 2 : 1;
    const perLeague = 3 * regionsCount;
    const leagues = (syncData?.configured?.length ?? 0) || odds.stored.feedMaxLeagues || 1;
    if (!perLeague || !leagues) return null;
    const listRuns = Math.floor(q.remaining / (perLeague * leagues));
    const deep = Number(fm.evLimit || 0) > 0;
    return { listRuns, deep, perRun: perLeague * leagues };
  })();

  const quotaPct = odds?.quota
    ? Math.round((odds.quota.used / (odds.quota.used + odds.quota.remaining)) * 100)
    : 0;
  const quotaLow = odds?.quota ? odds.quota.remaining < 1000 : false;
  const quotaWarn = odds?.quota ? odds.quota.remaining >= 1000 && odds.quota.remaining < 5000 : false;

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
    <div className="mx-auto w-full max-w-2xl px-0 sm:px-2">
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

      {/* ── Credits: live quota ───────────────────────────────── */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold">Credits — live quota</h1>
            <p className="text-sm text-ink2">Remaining balance on your The Odds API plan (checked via the free /v4/sports call, refreshed automatically).</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { apiFetch<OddsConfig>("/api/admin/odds-config").then((r) => r.ok && setOdds(r.data)); }}>
            Refresh
          </button>
        </div>
        {odds?.quota ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Remaining</div>
                <div className={`text-3xl font-extrabold ${quotaLow ? "text-red-600 dark:text-red-400" : quotaWarn ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                  {odds.quota.remaining.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Used this cycle</div>
                <div className="text-xl font-bold text-slate-900 dark:text-white">{odds.quota.used.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Plan total</div>
                <div className="text-xl font-bold text-slate-900 dark:text-white">{(odds.quota.used + odds.quota.remaining).toLocaleString()}</div>
              </div>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-card2">
              <div className={`h-full rounded-full ${quotaLow ? "bg-red-500" : quotaWarn ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${quotaPct}%` }} />
            </div>
            {runsLeft && (
              <p className="mt-2 text-xs text-ink2">
                <b>{runsLeft.listRuns.toLocaleString()} full sync runs left</b> on your current balance at {runsLeft.perRun.toLocaleString()} credits/run
                (list pass only)
                {runsLeft.deep && " — the deep-market pass adds credits per run; see Event markets below."}
              </p>
            )}
            {!odds?.quota && <p className="mt-2 text-xs text-amber-400">Quota unavailable — is ODDS_API_KEY set in the environment?</p>}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink3">Loading quota…</p>
        )}
      </div>

      {/* ── Odds engine preferences (credits 1–5) ─────────────── */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold">Odds engine preferences</h1>
            <p className="text-sm text-ink2">Per-client DB settings — Railway env vars (ODDS_API_*) override these when set.</p>
          </div>
          <button className="btn btn-primary btn-sm" disabled={savingOdds === "prefs"} onClick={() => saveOdds("prefs")}>
            {savingOdds === "prefs" ? "Saving…" : "Save preferences"}
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Bookmaker regions</label>
            <select className="input" value={fm.regions} onChange={(e) => setFm((f) => ({ ...f, regions: e.target.value }))}>
              {["eu,us", "eu", "us"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-ink3">
              <b>eu</b> = 3 credits/league (Pinnacle soccer). <b>eu,us</b> = 6 (adds US books; needed to price US sports).{" "}
              <b>us</b> = 3 (US books only).
            </p>
            {envTag("regions")}
          </div>
          <div>
            <label className="label">Min ms between API requests</label>
            <input className="input" type="number" min={50} value={fm.rateLimitMs} onChange={(e) => setFm((f) => ({ ...f, rateLimitMs: e.target.value }))} />
            <p className="mt-1 text-[11px] text-ink3">Rate limiting (1100 ≈ 1 req/sec). Lower only if your plan allows.</p>
            {envTag("rateLimitMs")}
          </div>
          <div>
            <label className="label">Event-market bookmakers</label>
            <input className="input font-mono text-xs" value={fm.bookmakers} onChange={(e) => setFm((f) => ({ ...f, bookmakers: e.target.value }))} placeholder="bovada,pinnacle" />
            <p className="mt-1 text-[11px] text-ink3">Books used by the deep per-event pass (bovada deepest, pinnacle fallback).</p>
            {envTag("eventBookmakers")}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Market keys (comma separated — empty = built-in menu)</label>
            <input className="input font-mono text-xs" value={fm.markets} onChange={(e) => setFm((f) => ({ ...f, markets: e.target.value }))} placeholder="h2h,spreads,totals,btts,double_chance,…" />
            <p className="mt-1 text-[11px] text-ink3">The list pass always uses h2h/spreads/totals; extra keys run on the per-event pass (≈1 credit per market per event).</p>
            {envTag("markets")}
          </div>
          <div>
            <label className="label">Catalog-mode league cap (per run)</label>
            <input className="input" type="number" min={1} value={fm.feedMaxLeagues} onChange={(e) => setFm((f) => ({ ...f, feedMaxLeagues: e.target.value }))} />
            <p className="mt-1 text-[11px] text-ink3">Only applies when the League Sync whitelist is empty.</p>
            {envTag("feedMaxLeagues")}
          </div>
        </div>
      </div>

      {/* ── Event markets (deep markets) ──────────────────────── */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold">Event markets (deep markets)</h1>
            <p className="text-sm text-ink2">
              Correct Score, BTTS, half-time, alternates, corners/cards — fetched per event from the featured leagues. ~1 credit per served market per event.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" disabled={savingOdds === "ev"} onClick={() => saveOdds("ev")}>
            {savingOdds === "ev" ? "Saving…" : "Save event markets"}
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Event market limit (nearest fixtures per league)</label>
            <input className="input" type="number" min={0} value={fm.evLimit} onChange={(e) => setFm((f) => ({ ...f, evLimit: e.target.value }))} />
            <p className="mt-1 text-[11px] text-ink3">
              <b>0</b> = deep pass OFF (cheapest: matches show 1X2 / Handicap / Over-Under + derived DC/DNB/BTTS). <b>2–4</b> = that many nearest fixtures per featured league get the full menu.
            </p>
            {envTag("eventMarketLimit")}
          </div>
          <div>
            <label className="label">Featured leagues (comma separated Odds API keys)</label>
            <input className="input font-mono text-xs" value={fm.evLeagues} onChange={(e) => setFm((f) => ({ ...f, evLeagues: e.target.value }))} placeholder="soccer_epl,soccer_uefa_champs_league" />
            <p className="mt-1 text-[11px] text-ink3">
              Empty = no league gets deep markets. Intersected with your League Sync whitelist — unlisted leagues are never charged.
            </p>
            {envTag("eventMarketLeagues")}
          </div>
        </div>
        {oddsMsg && <p className="mt-3 text-xs font-semibold text-green-600 dark:text-green-400">{oddsMsg}</p>}
      </div>

      {/* ── League sync whitelist ─────────────────────────────── */}
      <div className="card w-full max-w-full box-border overflow-hidden p-4 sm:p-6">
        <h1 className="text-lg font-extrabold">League sync — credit whitelist</h1>
        <p className="mt-1 break-words text-sm text-ink2 [overflow-wrap:anywhere]">
          The odds sync costs <b>1 request per league per run</b>. Leave the list empty to sync every
          bettable league (catalog order, capped by <code className="break-all font-mono text-xs">ODDS_API_FEED_MAX_LEAGUES</code>),
          or add only the leagues you offer — <b>nothing outside the list is ever queried</b>, so no credits
          are wasted on leagues you don&apos;t care about.
        </p>

        <div className="mt-4 grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: editor */}
          <div className="min-w-0 max-w-full">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
              <label className="label !mb-0">Leagues to sync (one key per line, in priority order)</label>
              {whitelistOn && (
                <span className="text-[11px] font-bold text-brand">
                  {parseLeagues(draft).length} league(s) ≈ {parseLeagues(draft).length} requests/run
                </span>
              )}
            </div>
            <textarea
              className="input box-border min-h-[200px] w-full max-w-full resize-y break-all font-mono text-xs !leading-5"
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
          <div className="flex min-h-[300px] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-line bg-card p-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink3" />
                <input
                  className="input box-border w-full max-w-full !py-1.5 !pl-8 text-xs"
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
                <div className="mt-2 flex w-full max-w-full flex-wrap gap-1.5">
                  {["soccer_", "basketball_", "tennis_", "icehockey_", "americanfootball_"].map((prefix) => {
                    const matches = syncData.catalog!.filter((c) => c.key.startsWith(prefix));
                    const anyOutside = matches.some((c) => !inDraft(c.key));
                    return (
                      <button
                        key={prefix}
                        type="button"
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
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
                          <code className="min-w-0 max-w-full flex-1 truncate font-mono text-[11px] text-ink">{c.key}</code>
                          <span className="shrink-0 max-w-[38%] truncate text-[10px] text-ink3">{c.name}</span>
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
