import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  IconTv,
  IconCalendar,
  IconPlug,
  IconGear,
  IconLightning,
  IconCoins,
} from "@/components/icons";

export const dynamic = "force-dynamic";

type Op = {
  name: string;
  route: string;
  description: string;
  type: "Monitor" | "Sync" | "Cron" | "API" | "Admin";
};

/** Daily operations — the pages and endpoints an operator touches regularly.
 *  Descriptions kept brief on purpose. */
const OPS: Op[] = [
  {
    name: "Live Monitor",
    route: "/live",
    description: "In-play matches, scores + ticking clocks. Auto-refreshes via The Odds API /scores (throttled).",
    type: "Monitor",
  },
  {
    name: "Today's Pre-match",
    route: "/",
    description: "Today's fixtures + odds on the homepage — DB-first feed (The Odds API → DB).",
    type: "Monitor",
  },
  {
    name: "Match Results",
    route: "/results",
    description: "Finished matches with final scores — spot-check before settlement.",
    type: "Monitor",
  },
  {
    name: "Manual Sync",
    route: "/admin/games",
    description: "⟳ Sync API button — pull fixtures + odds now. Costs ~10 requests; use sparingly.",
    type: "Sync",
  },
  {
    name: "Auto-Sync Cron",
    route: "/api/cron/sync",
    description: "Scheduled pre-match sync + live refresh. Call every ~6h with ?secret= (free-tier budget).",
    type: "Cron",
  },
  {
    name: "Settlement Cron",
    route: "/api/cron/settle",
    description: "Auto-settles finished games (WON/LOST/VOID). Call every ~10–15 min with ?secret=.",
    type: "Cron",
  },
  {
    name: "API Settings & Test",
    route: "/admin/api-settings",
    description: "The Odds API (v4) provider status + connection test — the single sports data source.",
    type: "Admin",
  },
  {
    name: "Feed Proxy",
    route: "/api/feed/matches",
    description: "Homepage pre-match feed route (The Odds API → DB). TTL-cached 6h.",
    type: "API",
  },
  {
    name: "Health Check",
    route: "/api/test/all",
    description: "Full The Odds API diagnostics (sports/odds/scores). Burns rate-limited requests — run only when needed.",
    type: "API",
  },
  {
    name: "Vouchers",
    route: "/admin/vouchers",
    description: "Generate/redeem/cancel deposit vouchers, batches, export + print.",
    type: "Admin",
  },
  {
    name: "Default Currency",
    route: "/admin/settings/currency",
    description: "Platform-wide display currency (KES/TZS/UGX/USD/EUR/GHS) — betslip + balances re-label instantly.",
    type: "Admin",
  },
  {
    name: "Currencies",
    route: "/admin/currencies",
    description: "Currency table + rates. Edits apply immediately (cache invalidated on save).",
    type: "Admin",
  },
  {
    name: "Announce",
    route: "/admin/notifications",
    description: "Site-wide announcement banner — shows until dismissed (client polls every 60s).",
    type: "Admin",
  },
  {
    name: "Audit Logs",
    route: "/admin/audit",
    description: "Admin action trail (CREATE/UPDATE/DELETE) across games, users, payments, config.",
    type: "Admin",
  },
  {
    name: "Website Settings",
    route: "/admin/settings",
    description: "Branding, limits, odds provider (The Odds API), support, payments, cron secret.",
    type: "Admin",
  },
];

const TYPE_STYLE: Record<Op["type"], string> = {
  Monitor: "bg-sky-500/15 text-sky-400",
  Sync: "bg-brand/15 text-brand",
  Cron: "bg-amber-500/15 text-amber-400",
  API: "bg-purple-500/15 text-purple-400",
  Admin: "bg-hover-tint text-ink2",
};

const TYPE_ICON: Record<Op["type"], React.ReactNode> = {
  Monitor: <IconTv className="h-3.5 w-3.5" />,
  Sync: <IconGear className="h-3.5 w-3.5" />,
  Cron: <IconCalendar className="h-3.5 w-3.5" />,
  API: <IconPlug className="h-3.5 w-3.5" />,
  Admin: <IconLightning className="h-3.5 w-3.5" />,
};

export default async function OpsPage() {
  const [liveCount, upcomingCount] = await Promise.all([
    prisma.game.count({ where: { status: { in: ["LIVE", "HALF_TIME", "IN_PLAY"] } } }),
    prisma.game.count({ where: { status: "SCHEDULED", startAt: { gt: new Date() } } }),
  ]);

  return (
    <div>
      {/* Quick status chips */}
      <div className="flex flex-wrap gap-2">
        <span className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-400">
          <span className="live-dot h-2 w-2" /> {liveCount} live now
        </span>
        <span className="flex items-center gap-2 rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
          <IconCalendar className="h-3.5 w-3.5" /> {upcomingCount} upcoming
        </span>
        <span className="flex items-center gap-2 rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
          <IconCoins className="h-3.5 w-3.5" /> Ops reference — links + request costs
        </span>
      </div>

      {/* Daily ops table */}
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
              <th className="px-4 py-3 font-bold">Operation</th>
              <th className="px-4 py-3 font-bold">Route</th>
              <th className="px-4 py-3 font-bold">Description</th>
              <th className="px-4 py-3 font-bold">Type</th>
            </tr>
          </thead>
          <tbody>
            {OPS.map((op) => (
              <tr key={op.name} className="border-b border-line/60 transition-colors last:border-0 hover:bg-hover-tint">
                <td className="px-4 py-3">
                  <Link href={op.route} className="font-bold text-ink hover:text-brand">
                    {op.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-hover-tint px-1.5 py-0.5 text-xs text-ink2">{op.route}</code>
                </td>
                <td className="max-w-md px-4 py-3 text-xs leading-relaxed text-ink2">{op.description}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_STYLE[op.type]}`}>
                    {TYPE_ICON[op.type]}
                    {op.type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink3">
        Budget watch: The Odds API free tier = 500 req/month; paid tiers raise this. Pre-match sync ~1 req/league,
        live scores ~1 req per active league per sweep (throttled).
      </p>
    </div>
  );
}
