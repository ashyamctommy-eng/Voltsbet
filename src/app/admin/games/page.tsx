"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { formatDateTime } from "@/lib/odds";
import { useToast } from "@/components/BetSlipContext";

type Game = {
  id: string; homeName: string; awayName: string; startAt: string; status: string;
  homeScore: number; awayScore: number; clock: string | null; source: string; featured: boolean;
  sport: { name: string; icon: string }; _count?: { markets: number };
};

export default function AdminGames() {
  const { push } = useToast();
  const [games, setGames] = useState<Game[]>([]);
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function load() {
    const url = `/api/admin/games${status ? `?status=${status}` : ""}`;
    const r = await apiFetch<{ games: Game[] }>(url);
    if (r.ok) setGames(r.data.games);
  }

  async function syncNow() {
    setSyncing(true);
    const r = await apiFetch<{ skipped?: boolean; reason?: string; created?: number; updated?: number; scoreUpdates?: number }>("/api/admin/sync", { method: "POST", body: {} });
    setSyncing(false);
    if (!r.ok) return push("error", r.error.message);
    if (r.data.skipped) return push("info", `Sync skipped: ${r.data.reason}`);
    push("success", `Sync done: ${r.data.created} new, ${r.data.updated} updated, ${r.data.scoreUpdates} scores`);
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Games</h2>
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-sm" onClick={syncNow} disabled={syncing} title="Pull games/odds from the configured sports API">
            {syncing ? "Syncing…" : "⟳ Sync API"}
          </button>
          <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="LIVE">Live</option>
            <option value="HALF_TIME">Half Time</option>
            <option value="FINISHED">Finished</option>
            <option value="POSTPONED">Postponed</option>
          </select>
          <Link href="/admin/games/new" className="btn btn-primary">+ Add Manual Game</Link>
        </div>
      </div>

      <div className="card divide-y divide-line">
        {games.length === 0 && <div className="p-8 text-center text-sm text-ink3">No games found.</div>}
        {games.map((g) => (
          <Link key={g.id} href={`/admin/games/${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
            <span className="text-xl">{g.sport.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{g.homeName} vs {g.awayName}</div>
              <div className="text-xs text-ink3">
                {g.sport.name} · {formatDateTime(new Date(g.startAt))} · {g._count?.markets ?? 0} markets · {g.source}
              </div>
            </div>
            {(g.status === "LIVE" || g.status === "HALF_TIME") ? (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-bold text-red-400">
                <span className="live-dot" /> {g.homeScore}–{g.awayScore} {g.clock ?? ""}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-xs font-semibold text-ink2">{g.status}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
