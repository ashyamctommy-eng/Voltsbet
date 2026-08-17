import Link from "next/link";
import { IconPlane, IconDice, IconLightning, IconController } from "@/components/icons";

const GAMES = [
  { name: "Aviator", Icon: IconPlane, bg: "from-red-600/80 to-orange-600/60", badge: null },
  { name: "Bazooka", Icon: IconController, bg: "from-slate-700/80 to-slate-900/70", badge: "NEW" },
  { name: "Aviatrix", Icon: IconPlane, bg: "from-purple-600/80 to-fuchsia-700/60", badge: null },
  { name: "JetX", Icon: IconPlane, bg: "from-indigo-700/80 to-violet-900/70", badge: null },
  { name: "Casino", Icon: IconDice, bg: "from-amber-500/80 to-orange-600/70", badge: null },
];

/** Featured Aviator / casino promo card + quick-launch game tiles. */
export default function CasinoHero() {
  return (
    <section className="mt-4">
      {/* Featured banner */}
      <Link
        href="/casino"
        className="card card-hover relative block overflow-hidden border-brand/20 p-5"
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-brand/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-accent/15 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-orange-500 shadow-lg shadow-red-900/40">
              <IconPlane className="h-8 w-8 text-white" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand">
                  Featured
                </span>
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-red-400">
                  Live
                </span>
              </div>
              <h2 className="mt-1.5 text-xl font-black tracking-tight">
                Aviator <span className="text-brand">—</span> fly high, cash out
              </h2>
              <p className="mt-0.5 text-sm text-ink2">
                Crash games, instant payouts, up to <span className="font-bold text-brand">×1000</span>.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/casino" className="btn btn-primary">Play now</Link>
            <Link href="/casino" className="btn btn-ghost hidden sm:inline-flex">Explore</Link>
          </div>
        </div>
      </Link>

      {/* Quick-launch game tiles */}
      <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {GAMES.map(({ name, Icon, bg, badge }) => (
          <Link
            key={name}
            href="/casino"
            className={`relative flex w-28 shrink-0 flex-col items-center gap-1.5 rounded-2xl bg-gradient-to-br ${bg} px-3 py-4 text-center shadow-lg transition-transform hover:scale-[1.03]`}
          >
            {badge && (
              <span className="absolute right-2 top-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white">
                {badge}
              </span>
            )}
            <Icon className="h-8 w-8 text-white" />
            <span className="text-sm font-bold text-white drop-shadow">{name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
