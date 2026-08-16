"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { fmtOdds } from "@/lib/odds";

type Outcome = {
  id: string; name: string; label: string | null; odds: string; status: string;
  settled: boolean; result: string | null; sortOrder: number;
  _count?: { selections: number };
};
type Market = { id: string; name: string; key: string; status: string; settlementMethod: string | null; outcomes: Outcome[] };
type GameDetail = {
  id: string; homeName: string; awayName: string; homeScore: number; awayScore: number;
  halfHomeScore: number | null; halfAwayScore: number | null; period: string | null; clock: string | null;
  status: string; source: string; featured: boolean; startAt: string;
  sport: { name: string; icon: string }; markets: Market[];
};

export default function AdminGameDetail() {
  const { id } = useParams<{ id: string }>();
  const { push } = useToast();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [liveForm, setLiveForm] = useState({ homeScore: 0, awayScore: 0, halfHomeScore: "", halfAwayScore: "", period: "", clock: "", status: "SCHEDULED" });
  const [savingLive, setSavingLive] = useState(false);
  const [marketForm, setMarketForm] = useState({ name: "", key: "MATCH_RESULT", status: "OPEN" });
  const [outcomeRows, setOutcomeRows] = useState([{ name: "", label: "", odds: "" }]);
  const [addingMarket, setAddingMarket] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<{ game: GameDetail }>(`/api/admin/games/${id}`);
    if (r.ok) {
      setGame(r.data.game);
      setLiveForm({
        homeScore: r.data.game.homeScore, awayScore: r.data.game.awayScore,
        halfHomeScore: r.data.game.halfHomeScore?.toString() ?? "",
        halfAwayScore: r.data.game.halfAwayScore?.toString() ?? "",
        period: r.data.game.period ?? "", clock: r.data.game.clock ?? "", status: r.data.game.status,
      });
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!game) return <div className="card p-8 text-center text-ink3">Loading…</div>;

  async function saveLive(e: React.FormEvent) {
    e.preventDefault();
    setSavingLive(true);
    const res = await apiFetch(`/api/admin/games/${id}`, {
      method: "PATCH",
      body: {
        homeScore: Number(liveForm.homeScore) || 0,
        awayScore: Number(liveForm.awayScore) || 0,
        halfHomeScore: liveForm.halfHomeScore ? Number(liveForm.halfHomeScore) : null,
        halfAwayScore: liveForm.halfAwayScore ? Number(liveForm.halfAwayScore) : null,
        period: liveForm.period || null,
        clock: liveForm.clock || null,
        status: liveForm.status,
      },
    });
    setSavingLive(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Game updated");
    load();
  }

  async function patchOutcome(o: Outcome, body: Record<string, unknown>) {
    const res = await apiFetch(`/api/admin/outcomes/${o.id}`, { method: "PATCH", body });
    if (!res.ok) return push("error", res.error.message);
    load();
  }

  async function patchMarket(m: Market, body: Record<string, unknown>) {
    const res = await apiFetch(`/api/admin/markets/${m.id}`, { method: "PATCH", body });
    if (!res.ok) return push("error", res.error.message);
    load();
  }

  async function settle(o: Outcome, result: "WON" | "LOST" | "VOID") {
    if (o.settled) return push("error", "Already settled — reopen first.");
    const res = await apiFetch<{ affected: string[] }>(`/api/admin/settle/${o.id}`, { method: "POST", body: { result } });
    if (!res.ok) return push("error", res.error.message);
    push("success", `${o.name}: ${result}. ${res.data.affected?.length ?? 0} bet(s) processed.`);
    load();
  }

  async function reopen(o: Outcome) {
    const res = await apiFetch(`/api/admin/settle/${o.id}/reopen`, { method: "POST", body: {} });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Settlement reopened");
    load();
  }

  async function addMarket(e: React.FormEvent) {
    e.preventDefault();
    if (!marketForm.name.trim()) return push("error", "Market name required");
    const outcomes = outcomeRows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), label: r.label.trim(), odds: Number(r.odds) }));
    if (!outcomes.length) return push("error", "Add at least one outcome");
    if (outcomes.some((o) => !(o.odds > 0))) return push("error", "Every outcome needs positive odds");
    const res = await apiFetch(`/api/admin/games/${id}/markets`, {
      method: "POST",
      body: { name: marketForm.name, key: marketForm.key, status: marketForm.status, outcomes },
    });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Market added");
    setMarketForm({ name: "", key: "CUSTOM", status: "OPEN" });
    setOutcomeRows([{ name: "", label: "", odds: "" }]);
    setAddingMarket(false);
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl">{game.sport.icon}</span>
        <div>
          <h2 className="text-xl font-extrabold">{game.homeName} vs {game.awayName}</h2>
          <div className="text-xs text-ink3">
            {game.sport.name} · Source: {game.source} · Started {new Date(game.startAt).toLocaleString("en-GB")}
            {game.featured && <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 font-bold text-brand">FEATURED</span>}
          </div>
        </div>
        <span className="ml-auto rounded-full bg-card2 px-3 py-1 text-xs font-bold uppercase text-ink2">{game.status}</span>
      </div>

      {/* Live control */}
      <form onSubmit={saveLive} className="card p-5">
        <h3 className="font-bold">Live Score Control</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <label className="label">{game.homeName} score</label>
            <input className="input" type="number" value={liveForm.homeScore} onChange={(e) => setLiveForm({ ...liveForm, homeScore: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">{game.awayName} score</label>
            <input className="input" type="number" value={liveForm.awayScore} onChange={(e) => setLiveForm({ ...liveForm, awayScore: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">HT home</label>
            <input className="input" type="number" value={liveForm.halfHomeScore} onChange={(e) => setLiveForm({ ...liveForm, halfHomeScore: e.target.value })} />
          </div>
          <div>
            <label className="label">HT away</label>
            <input className="input" type="number" value={liveForm.halfAwayScore} onChange={(e) => setLiveForm({ ...liveForm, halfAwayScore: e.target.value })} />
          </div>
          <div>
            <label className="label">Period</label>
            <input className="input" value={liveForm.period} onChange={(e) => setLiveForm({ ...liveForm, period: e.target.value })} placeholder="2H / Q4" />
          </div>
          <div>
            <label className="label">Clock</label>
            <input className="input" value={liveForm.clock} onChange={(e) => setLiveForm({ ...liveForm, clock: e.target.value })} placeholder="67:42" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select className="input w-48" value={liveForm.status} onChange={(e) => setLiveForm({ ...liveForm, status: e.target.value })}>
            {["SCHEDULED", "LIVE", "HALF_TIME", "SUSPENDED", "POSTPONED", "FINISHED", "CANCELLED"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="btn btn-primary" disabled={savingLive}>{savingLive ? "Saving…" : "Update Game"}</button>
          {game.status === "FINISHED" && (
            <span className="text-xs font-semibold text-amber-400">Settled your markets below — then bets are paid automatically.</span>
          )}
        </div>
      </form>

      {/* Markets */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Markets ({game.markets.length})</h3>
          <button className="btn btn-accent btn-sm" onClick={() => setAddingMarket((v) => !v)}>+ Add Market</button>
        </div>

        {addingMarket && (
          <form onSubmit={addMarket} className="card space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Market name</label>
                <input className="input" value={marketForm.name} onChange={(e) => setMarketForm({ ...marketForm, name: e.target.value })} placeholder="Match Result" required />
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={marketForm.key} onChange={(e) => setMarketForm({ ...marketForm, key: e.target.value })}>
                  {["MATCH_RESULT", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS", "CORRECT_SCORE", "HT_RESULT", "DRAW_NO_BET", "HANDICAP", "CUSTOM"].map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={marketForm.status} onChange={(e) => setMarketForm({ ...marketForm, status: e.target.value })}>
                  {["OPEN", "SUSPENDED", "CLOSED"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Outcomes</label>
              <div className="space-y-2">
                {outcomeRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_90px_36px] gap-2">
                    <input className="input" placeholder="Outcome name (e.g. Home)" value={row.name} onChange={(e) => setOutcomeRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} />
                    <input className="input" placeholder="Label" value={row.label} onChange={(e) => setOutcomeRows((rs) => rs.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))} />
                    <input className="input" type="number" step="0.01" placeholder="Odds" value={row.odds} onChange={(e) => setOutcomeRows((rs) => rs.map((r, j) => (j === i ? { ...r, odds: e.target.value } : r)))} />
                    <button type="button" className="btn btn-danger btn-sm h-10" onClick={() => setOutcomeRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
              <button type="button" className="mt-2 text-xs font-semibold text-brand" onClick={() => setOutcomeRows((rs) => [...rs, { name: "", label: "", odds: "" }])}>
                + Add outcome
              </button>
            </div>
            <button className="btn btn-primary w-fit">Create Market</button>
          </form>
        )}

        {game.markets.map((m) => (
          <div key={m.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <h4 className="font-bold">{m.name}</h4>
              <span className="rounded-full bg-card2 px-2 py-0.5 text-[10px] font-bold uppercase text-ink2">{m.key}</span>
              <select
                className="input ml-auto w-36 py-1.5"
                value={m.status}
                onChange={(e) => patchMarket(m, { status: e.target.value })}
              >
                {["OPEN", "SUSPENDED", "CLOSED", "SETTLED"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink3">
                  <th className="px-4 py-2 font-semibold">Selection</th>
                  <th className="px-2 py-2 font-semibold">Odds</th>
                  <th className="px-2 py-2 font-semibold">State</th>
                  <th className="px-2 py-2 font-semibold">Bets</th>
                  <th className="px-4 py-2 text-right font-semibold">Settle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {m.outcomes.map((o) => (
                  <tr key={o.id} className={o.settled ? "opacity-70" : ""}>
                    <td className="px-4 py-2">
                      {o.label && <span className="mr-1.5 rounded bg-card2 px-1.5 py-0.5 text-[10px] font-bold text-ink2">{o.label}</span>}
                      <span className="font-medium">{o.name}</span>
                      {o.settled && (
                        <span className={`ml-2 text-xs font-bold ${o.result === "WON" ? "text-green-400" : o.result === "VOID" ? "text-gray-400" : "text-red-400"}`}>
                          {o.result}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        key={o.id}
                        className="input w-20 py-1.5 text-center font-bold"
                        defaultValue={fmtOdds(o.odds)}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (v > 0 && Math.abs(v - Number(o.odds)) > 0.001) patchOutcome(o, { odds: v });
                        }}
                        disabled={o.settled}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        className={`rounded-full px-2 py-1 text-[10px] font-bold ${o.status === "ACTIVE" ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}
                        onClick={() => patchOutcome(o, { status: o.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}
                        disabled={o.settled}
                      >
                        {o.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED"}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-xs text-ink3">{o._count?.selections ?? 0}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">
                        {o.settled ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => reopen(o)}>Reopen</button>
                        ) : (
                          <>
                            <button className="btn btn-sm bg-green-600 text-white hover:brightness-110" onClick={() => settle(o, "WON")}>Won</button>
                            <button className="btn btn-sm bg-red-600 text-white hover:brightness-110" onClick={() => settle(o, "LOST")}>Lost</button>
                            <button className="btn btn-sm bg-gray-600 text-white hover:brightness-110" onClick={() => settle(o, "VOID")}>Void</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
