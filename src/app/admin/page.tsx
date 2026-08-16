"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";

type Stats = {
  totalUsers: number; activeUsers: number; newRegistrations: number;
  totalDeposits: number; totalWithdrawals: number; totalStakes: number;
  openBets: number; winningBets: number; losingBets: number;
  pendingWithdrawals: number; pendingDeposits: number;
  activeGames: number; liveGames: number; revenue: number;
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ stats: Stats }>("/api/admin/stats").then((r) => {
      if (r.ok) setStats(r.data.stats);
      else setError(r.error.message);
    });
  }, []);

  if (error) return <div className="card p-8 text-red-300">{error}</div>;
  if (!stats) return <div className="grid grid-cols-2 gap-4 md:grid-cols-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;

  const cards: { label: string; value: string; sub?: string; accent?: boolean }[] = [
    { label: "Total Users", value: stats.totalUsers.toLocaleString(), sub: `${stats.newRegistrations} new this week` },
    { label: "Active Users", value: stats.activeUsers.toLocaleString() },
    { label: "Open Bets", value: stats.openBets.toLocaleString(), sub: `${stats.liveGames} games live` },
    { label: "Live Games", value: stats.liveGames.toString(), accent: true },
    { label: "Total Deposits", value: money(stats.totalDeposits), sub: "all time" },
    { label: "Total Withdrawals", value: money(stats.totalWithdrawals) },
    { label: "Total Stakes", value: money(stats.totalStakes) },
    { label: "Winning / Losing Bets", value: `${stats.winningBets} / ${stats.losingBets}` },
    { label: "Pending Deposits", value: stats.pendingDeposits.toString(), sub: "awaiting payment/confirmation" },
    { label: "Pending Withdrawals", value: stats.pendingWithdrawals.toString(), sub: "needs review" },
    { label: "Active Games", value: stats.activeGames.toString() },
    { label: "Margin (stakes)", value: money(stats.revenue) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs text-ink3">{c.label}</div>
            <div className={`mt-1 text-xl font-extrabold ${c.accent ? "text-red-400" : ""}`}>{c.value}</div>
            {c.sub && <div className="mt-0.5 text-[11px] text-ink3">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/admin/games" className="card card-hover p-5">
          <div className="text-2xl">🗓️</div>
          <div className="mt-2 font-bold">Manage Games</div>
          <div className="text-xs text-ink3">Create manual games, control live scores, add markets.</div>
        </Link>
        <Link href="/admin/deposits" className="card card-hover p-5">
          <div className="text-2xl">📥</div>
          <div className="mt-2 font-bold">Crypto Transactions</div>
          <div className="text-xs text-ink3">Track deposits, confirm payments, review history.</div>
        </Link>
        <Link href="/admin/users" className="card card-hover p-5">
          <div className="text-2xl">👥</div>
          <div className="mt-2 font-bold">Users</div>
          <div className="text-xs text-ink3">Verify, suspend and manage player accounts.</div>
        </Link>
      </div>
    </div>
  );
}

function money(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function SkeletonCard() {
  return <div className="skeleton h-24" />;
}
