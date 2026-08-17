"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { IconCoins, IconSmartphone, IconCalendar, IconDownload, IconUsers, IconChevronRight } from "@/components/icons";

type Stats = {
  totalUsers: number; activeUsers: number; newRegistrations: number;
  totalDeposits: number; totalWithdrawals: number; totalStakes: number;
  openBets: number; winningBets: number; losingBets: number;
  pendingWithdrawals: number; pendingDeposits: number;
  activeGames: number; liveGames: number; revenue: number;
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ stats: Stats }>("/api/admin/stats").then((r) => {
      if (r.ok) setStats(r.data.stats);
      else setError(r.error.message);
    });
    apiFetch<{ settings: Record<string, string> }>("/api/admin/settings").then((r) => {
      if (r.ok) setSettings(r.data.settings);
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

      {/* Payment providers status */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <IconCoins className="h-5 w-5 text-brand" /> Payment Providers
          </h2>
          <Link href="/admin/settings#payments" className="flex items-center gap-1 text-xs font-bold text-brand hover:underline">
            Configure <IconChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-[#0d1526] p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold">
                <IconCoins className="h-4 w-4 text-warn" /> NOWPayments
              </span>
              <StatusPill ok={settings["crypto.provider"] === "NOWPAYMENTS" && !!settings["crypto.apiKey"]} onText="Live" offText="Not configured" />
            </div>
            <div className="mt-3 space-y-1 text-xs text-ink2">
              <Row k="Provider" v={settings["crypto.provider"] || "—"} />
              <Row k="API key" v={settings["crypto.apiKey"] ? "•••••••• set" : "missing"} />
              <Row k="Currencies" v={settings["crypto.currencies"] ? JSON.parse(settings["crypto.currencies"] || "[]").join(", ") : "—"} />
              <Row k="Min / Max" v={`${settings["crypto.minDeposit"] || "—"} / ${settings["crypto.maxDeposit"] || "—"}`} />
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-[#0d1526] p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold">
                <IconSmartphone className="h-4 w-4 text-brand" /> M-Pesa (Daraja)
              </span>
              <StatusPill ok={settings["mpesa.enabled"] === "true" && !!settings["mpesa.consumerKey"]} onText="Live" offText="Off" />
            </div>
            <div className="mt-3 space-y-1 text-xs text-ink2">
              <Row k="Enabled" v={settings["mpesa.enabled"] === "true" ? "Yes" : "No"} />
              <Row k="Environment" v={settings["mpesa.env"] || "—"} />
              <Row k="Paybill" v={settings["mpesa.shortcode"] || "—"} />
              <Row k="Consumer key" v={settings["mpesa.consumerKey"] ? "•••••••• set" : "missing"} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/admin/games" className="card card-hover p-5">
          <IconCalendar className="h-6 w-6 text-brand" />
          <div className="mt-2 font-bold">Manage Games</div>
          <div className="text-xs text-ink3">Create manual games, control live scores, add markets.</div>
        </Link>
        <Link href="/admin/deposits" className="card card-hover p-5">
          <IconDownload className="h-6 w-6 text-brand" />
          <div className="mt-2 font-bold">Crypto Transactions</div>
          <div className="text-xs text-ink3">Track deposits, confirm payments, review history.</div>
        </Link>
        <Link href="/admin/users" className="card card-hover p-5">
          <IconUsers className="h-6 w-6 text-brand" />
          <div className="mt-2 font-bold">Users</div>
          <div className="text-xs text-ink3">Verify, suspend and manage player accounts.</div>
        </Link>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink3">{k}</span>
      <span className="font-semibold text-ink">{v}</span>
    </div>
  );
}

function StatusPill({ ok, onText, offText }: { ok: boolean; onText: string; offText: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
        ok ? "bg-brand/15 text-brand" : "bg-gray-500/15 text-gray-400"
      }`}
    >
      {ok ? onText : offText}
    </span>
  );
}

function money(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function SkeletonCard() {
  return <div className="skeleton h-24" />;
}
