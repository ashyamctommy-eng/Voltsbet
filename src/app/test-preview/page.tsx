"use client";

/**
 * TEST-ONLY — Visual preview for the Sportmonks + The-Odds-API hybrid match
 * card. Renders real Sportmonks fixtures (when a token is configured) with
 * mock 1X2 prices, and lets you flip between "odds matched" and "odds
 * missing (-)" states. Delete before the hybrid feed goes to production.
 */
import { useEffect, useState } from "react";
import HybridMatchCard from "@/components/HybridMatchCard";
import type { HybridMatch } from "@/app/api/test-hybrid-feed/route";

type FeedResponse = {
  source: string;
  note: string;
  date: string;
  count: number;
  matches: HybridMatch[];
};

const SOURCE_LABEL: Record<string, string> = {
  "sportmonks-live": "Sportmonks LIVE fixtures (token configured)",
  "sportmonks-empty": "Sportmonks returned no fixtures today",
  "sportmonks-error-fallback": "Sportmonks failed — static fallback fixtures",
  "static-fallback": "Static fallback fixtures (no SPORTMONKS_API_TOKEN)",
};

export default function TestPreviewPage() {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"matched" | "missing">("matched");
  const [mockMode, setMockMode] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-hybrid-feed${mockMode ? "?mock=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [mockMode]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-extrabold text-ink">Hybrid Match Card — Preview</h1>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
            TEST PAGE
          </span>
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
            {data ? SOURCE_LABEL[data.source] ?? data.source : "loading…"}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink3">
          {data?.note ?? "Loading /api/test-hybrid-feed…"} · {data ? `${data.count} fixtures · ${data.date}` : ""}
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setMode("matched")}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              mode === "matched" ? "bg-brand text-black" : "bg-panel-bg text-ink2 hover:text-ink"
            }`}
          >
            Odds matched
          </button>
          <button
            type="button"
            onClick={() => setMode("missing")}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              mode === "missing" ? "bg-brand text-black" : "bg-panel-bg text-ink2 hover:text-ink"
            }`}
          >
            Odds missing (−)
          </button>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink2 transition-colors hover:text-ink"
        >
          ↻ Refresh data
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-ink2">
          <input
            type="checkbox"
            checked={mockMode}
            onChange={(e) => setMockMode(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--vb-primary,#00e676)]"
          />
          Mock odds (design mode)
        </label>
        <span className="text-[11px] text-ink3">
          Toggle simulates the card when odds are {mode === "matched" ? "matched (1X2 prices)" : "missing / null (— placeholders)"}.
        </span>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="card p-10 text-center text-sm text-ink3">Loading hybrid feed…</div>
      ) : error ? (
        <div className="card p-10 text-center text-sm text-red-400">Failed to load: {error}</div>
      ) : data ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink3">
              Fixtures {mode === "missing" ? "· simulating missing odds" : ""}
            </h2>
            <span className="text-[11px] font-semibold text-ink3">{data.matches.length} cards</span>
          </div>
          <div className="grid gap-2.5">
            {data.matches.map((m) => (
              <HybridMatchCard key={m.id} match={m} forceMissing={mode === "missing"} />
            ))}
          </div>
        </>
      ) : null}

      {/* Legend */}
      <div className="card mt-8 p-4 text-xs text-ink3">
        <h3 className="mb-2 font-bold text-ink">How to read this preview</h3>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>Sportmonks</b> supplies fixtures — teams, league, venue, kickoff, status. Odds come from its Odds Feed only when the plan includes it (your trial: 403 gated → the chain falls through).</li>
          <li><b>The Odds API</b> supplies real h2h + totals prices (aggregated across books). When neither source has a fixture's odds, the card shows <b>No odds available</b> — real data only, no mock unless you tick “Mock odds (design mode)”.</li>
          <li><b>First view</b> of each card shows no markets — click the <b>Markets ▾</b> arrow to expand the full fixture info + market accordion, then a market row to drop its odds.</li>
          <li>“Odds missing (−)” flips every expanded market to muted “-” placeholders for design inspection.</li>
        </ul>
      </div>
    </div>
  );
}
