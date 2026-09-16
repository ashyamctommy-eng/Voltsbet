import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { HALF_TIME_MARKET_KEYS } from "@/lib/settlement/resolve-stats";
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
    name: "Settlement Queue",
    route: "/admin/settlement",
    description: "Every waiting bet + unfinished fixture in one searchable list, money first, one click to settle. Use this instead of hunting through Games → All statuses.",
    type: "Admin",
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
  Sync: "bg-brand/15 text-brand-text",
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
  // A bet is "waiting" once its match has been over for a few hours. This is
  // the only number with a customer on the other end of it — a finished match
  // with an open bet that nobody has settled is a complaint in the making.
  // (Built from `new Date()`, not Date.now(), so the render-compiler lint rule
  // does not treat it as an impure call during render.)
  const stuckCutoff = new Date(new Date().getTime() - 6 * 60 * 60 * 1000);
  const [liveCount, upcomingCount, htOpen, catchAllOpen, otherOpen, stuckBets] = await Promise.all([
    prisma.game.count({ where: { status: { in: ["LIVE", "HALF_TIME", "IN_PLAY"] } } }),
    prisma.game.count({ where: { status: "SCHEDULED", startAt: { gt: new Date() } } }),
    // Half-time family on finished matches. The /scores feed carries no
    // half-time score, so nothing here can ever settle itself.
    prisma.outcome.count({
      where: {
        settled: false,
        market: { key: { in: [...HALF_TIME_MARKET_KEYS] }, game: { status: "FINISHED" } },
      },
    }),
    // Correct-score catch-all buckets ("Any Other Home Win").
    prisma.outcome.count({
      where: {
        settled: false,
        name: { startsWith: "Any Other" },
        market: { game: { status: "FINISHED" } },
      },
    }),
    prisma.outcome.count({
      where: {
        settled: false,
        name: { not: { startsWith: "Any Other" } },
        market: { key: { notIn: [...HALF_TIME_MARKET_KEYS] }, game: { status: "FINISHED" } },
      },
    }),
    prisma.bet.count({
      where: {
        status: "OPEN",
        selections: { some: { game: { status: "FINISHED", startAt: { lt: stuckCutoff } } } },
      },
    }),
  ]);
  const attention = htOpen + catchAllOpen + otherOpen;

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
                  <Link href={op.route} className="font-bold text-ink hover:text-brand-text">
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

      {/* Needs attention — what auto-settlement cannot do by itself.
          Everything here used to be invisible until a customer complained. */}
      <div className={`card mt-4 p-5 text-sm ${stuckBets > 0 ? "border-amber-500/40" : ""}`}>
        <h3 className="flex items-center gap-2 font-bold">
          <IconCoins className="h-4 w-4 text-brand-text" />
          Settlement needs attention
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <span
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold ${
              stuckBets > 0 ? "bg-amber-500/15 text-amber-400" : "bg-hover-tint text-ink2"
            }`}
          >
            {stuckBets} open bet{stuckBets === 1 ? "" : "s"} waiting on a finished match
          </span>
          <span className="flex items-center gap-2 rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
            {htOpen} half-time outcome{htOpen === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-2 rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
            {catchAllOpen} correct-score catch-all{catchAllOpen === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-2 rounded-lg bg-hover-tint px-3 py-1.5 text-xs font-bold text-ink2">
            {otherOpen} other outcome{otherOpen === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink2">
          <>
            <Link href="/admin/settlement" className="font-bold text-brand-text underline-offset-2 hover:underline">
              Open the Settlement Queue →
            </Link>{" "}
            — every waiting bet and unfinished fixture in one searchable list, newest money first.
          </>
          {attention === 0 && stuckBets === 0 ? (
            <> Nothing outstanding — every finished match is settled.</>
          ) : (
            <>
              {" "}
              <b className="text-ink">Fix half-time markets:</b> they need a half-time score, which the odds feed never
              sends. Enter it on the match page — the settlement cron clears every half-time market on the match.
              <b className="text-ink"> Everything else</b> (corners, cards, correct-score lines) is settled per outcome
              with Won/Lost/Void on the match page. Nothing here settles twice: the cron skips outcomes already done.
            </>
          )}
        </p>
      </div>

      {/* Settlement explainer — derived + API-served markets */}
      <div className="card mt-4 p-5 text-sm">
        <h3 className="flex items-center gap-2 font-bold">
          <IconCoins className="h-4 w-4 text-brand-text" />
          Auto-settlement — derived &amp; API-served markets
        </h3>
        <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink2">
          <p>
            <b className="text-ink">What auto-settles:</b> the Settlement Cron resolves every FINISHED game&apos;s
            outcomes from the final score once the settlement delay (Admin → Website Settings →{" "}
            <code className="rounded bg-hover-tint px-1">settlement.delayMinutes</code>, default 10) passes. Both
            market sources share one resolver (<code className="rounded bg-hover-tint px-1">resolveOutcome</code>):
            the <b className="text-ink">API-served</b> markets (h2h, totals, spreads/alternates, double chance, draw
            no bet, BTTS, correct score, HT/FT …) and the <b className="text-ink">derived-engine</b> boards the sync
            generates from them (double chance, draw no bet, clean sheet, win to nil, multi-goals, odd/even,
            highest-scoring-half …) — same outcome-name conventions, same resolution. Bets are paid out automatically;
            no manual step.
          </p>
          <p>
            <b className="text-ink">What stays for admin review:</b> auto-settlement never guesses. Left unsettled
            (Won/Lost/Void buttons on the match page):
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Half-time-dependent markets</b> when the /scores feed has no half-time score — HT/FT, 1st/2nd-half results and totals, 1st-half BTTS, highest-scoring-half. If the DB has half scores they settle automatically.</li>
            <li><b className="text-ink">Corners / cards / player-prop markets</b> (total corners, corner handicaps, bookings, anytime scorer …) — the feed carries no corner/card/player stats, so decide from your external source.</li>
            <li><b className="text-ink">Asian quarter-line splits</b> that land mixed (half-win/half-push) — not expressible in a single outcome; whole/half lines settle fine.</li>
            <li>Unknown keys, unusual outcome names, live edges.</li>
          </ul>
          <p>
            <b className="text-ink">How to settle manually:</b> Admin → Games → filter{" "}
            <code className="rounded bg-hover-tint px-1">FINISHED</code> → open the match → each unsettled outcome
            row shows <b className="text-ink">Won / Lost / Void</b> — pick the result and bets pay automatically.
            Wrong call? Reopen the outcome and re-settle. The cron skips settled outcomes, so a leftover queue never
            double-pays.
          </p>
        </div>
      </div>
    </div>
  );
}
