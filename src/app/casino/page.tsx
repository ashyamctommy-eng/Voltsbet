import Link from "next/link";
import { IconPlane, IconDice, IconController, IconLightning, IconChevronRight } from "@/components/icons";

export const metadata = { title: "Casino" };

const GAMES = [
  { name: "Aviator", Icon: IconPlane, bg: "from-red-600 to-orange-600", desc: "Crash game · cash out before it flies away", tag: "Trending" },
  { name: "Bazooka", Icon: IconController, bg: "from-slate-700 to-slate-950", desc: "Arcade shooter with instant rewards", tag: "NEW" },
  { name: "Aviatrix", Icon: IconPlane, bg: "from-purple-600 to-fuchsia-800", desc: "Aviator, but the pilot is in charge", tag: null },
  { name: "JetX", Icon: IconPlane, bg: "from-indigo-700 to-violet-950", desc: "Multiplier rocket · up to ×1000", tag: null },
  { name: "Casino Slots", Icon: IconDice, bg: "from-amber-500 to-orange-700", desc: "Slots, roulette, blackjack & more", tag: null },
  { name: "Crash", Icon: IconLightning, bg: "from-emerald-600 to-teal-800", desc: "Classic crash curve, big volatility", tag: "Popular" },
];

export default function CasinoPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-xl font-black tracking-tight">Casino</h1>
        <span className="rounded-full bg-brand/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-brand">
          Coming soon
        </span>
      </div>
      <p className="mt-1 text-sm text-ink2">
        Crash games and slots are being wired up — these tiles launch the moment the
        first provider goes live.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map(({ name, Icon, bg, desc, tag }) => (
          <div key={name} className={`card card-hover relative overflow-hidden bg-gradient-to-br ${bg} p-5`}>
            {tag && (
              <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                {tag}
              </span>
            )}
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/25">
              <Icon className="h-7 w-7 text-white" />
            </span>
            <h2 className="mt-3 text-lg font-black text-white">{name}</h2>
            <p className="mt-0.5 text-xs text-white/70">{desc}</p>
            <button disabled className="btn btn-primary btn-sm mt-4 !cursor-not-allowed !opacity-60">
              Launch — soon
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-card p-6 text-center">
        <h3 className="font-bold">Want real casino games on VoltBet?</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink2">
          We can integrate provider-backed games (slots, live casino, crash) through
          aggregation platforms — say the word and I'll spec the integration.
        </p>
        <Link href="/promotions" className="btn btn-ghost btn-sm mt-4">
          See promotions <IconChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
