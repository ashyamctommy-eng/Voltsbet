import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  IconTv,
  IconCalendar,
  IconPlug,
  IconGear,
  IconLightning,
} from "@/components/icons";

export const dynamic = "force-dynamic";

type Op = {
  name: string;
  route: string;
  description: string;
  type: "Monitor" | "Sync" | "API" | "Cron" | "Admin";
  external?: boolean;
};

/** Daily operations — the pages and endpoints an operator touches regularly. */
const OPS: Op[] = [
  {
    name: "Live Monitor",
    route: "/live",
    description:
      "In-play matches with real-time scores and ticking timers. Auto-refreshes every live.refreshSeconds and pulls fresh scores from BetsAPI inplay on each poll (throttled to 1 request per window).",
    type: "Monitor",
  },
  {
    name: "Match Results",
    route: "/results",
    description: "Finished matches with final scores — spot-check before settlement kicks in.",
    type: "Monitor",
  },
  {
    name: "Sync API",
    route: "/admin/games",
    description:
      "Pull upcoming fixtures + prematch odds from the primary provider (⟳ Sync API button on the Games page). Cost: 1 upcoming list + N prematch requests per run.",
    type: "Sync",
  },
  {
    name: "API Settings & Test",
    route: "/admin/api-settings",
    description:
      "BetsAPI credentials (RapidAPI key / host / base), primary-provider toggle, and the 2-step Test Primary Connection (upcoming list + prematch market chips). Saving clears the feed cache.",
    type: "Admin",
  },
  {
    name: "Feed Proxy (homepage)",
    route: "/api/betsapi/matches",
    description:
      "Transformed upcoming feed behind the homepage — BetsAPI first, The Odds API free fallback when quota-blocked, stale snapshot while everything is down. TTL-cached.",
    type: "API",
  },
  {
    name: "Health Check",
    route: "/api/test/all",
    description:
      "Full BetsAPI health array — 7 endpoints checked sequentially (inplay, event, upcoming, league, prematch, result). Burns several rate-limited requests per run.",
    type: "API",
  },
  {
    name: "Settlement Cron",
    route: "/api/cron/settle",
    description:
      "Settles finished games into WON/LOST after settlement.delayMinutes (10 min default). Call every ~10 min from any scheduler with the cron secret.",
    type: "Cron",
  },
  {
    name: "Announce",
    route: "/admin/notifications",
    description: "Post a site-wide announcement banner — shows on every page until dismissed (client polls every 60s).",
    type: "Admin",
  },
  {
    name: "Currencies",
    route: "/admin/currencies",
    description: "Deposit/payout currencies and rates — edits apply immediately (cache invalidated on save).",
    type: "Admin",
  },
  {
    name: "Audit Logs",
    route: "/admin/audit",
    description: "Trail of admin actions (CREATE / UPDATE / DELETE) across games, users, payments and config.",
    type: "Admin",
  },
];

const TYPE_STYLE: Record<Op["type"], string> = {
  Monitor: "bg-sky-500/15 text-sky-400",
  Sync: "bg-brand/15 text-brand",
  API: "bg-purple-500/15 text-purple-400",
  Cron: "bg-amber-500/15 text-amber-400",
  Admin: "bg-white/10 text-ink2",
};

const TYPE_ICON: Record<Op["type"], React.ReactNode> = {
  Monitor: <IconTv className="h-3.5 w-3.5" />,
  Sync: <IconGear className="h-3.5 w-3.5" />,
  API: <IconPlug className="h-3.5 w-3.5" />,
  Cron: <IconCalendar className="h-3.5 w-3.5" />,
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
        <span className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-bold text-ink2">
          <IconCalendar className="h-3.5 w-3.5" /> {upcomingCount} upcoming
        </span>
        <span className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-bold text-ink2">
          <IconLightning className="h-3.5 w-3.5" /> Ops reference — links + costs
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
              <tr key={op.name} className="border-b border-line/60 transition-colors last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <Link href={op.route} className="font-bold text-ink hover:text-brand">
                    {op.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-ink2">{op.route}</code>
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
        Tip: watch request budgets — each Sync, Test Connection, Health Check and feed refresh counts against the
        RapidAPI hourly quota.
      </p>
    </div>
  );
}
