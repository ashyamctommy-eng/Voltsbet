import { IconLightning } from "@/components/icons";

export const metadata = { title: "Virtual Football" };

// Static demo fixtures — virtual football is simulated; odds are display-only
// until a virtual sports engine is wired up.
const FIXTURES = [
  { home: "Red Lions", away: "Blue Falcons", minute: "23'", score: "1 – 1", odds: ["2.05", "3.30", "3.45"] },
  { home: "Silver Wolves", away: "Green Rhinos", minute: "11'", score: "0 – 0", odds: ["1.95", "3.40", "3.80"] },
  { home: "Golden Eagles", away: "Crimson Bulls", minute: "41'", score: "2 – 0", odds: ["1.60", "4.20", "5.10"] },
];

export default function VFootballPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
          <IconLightning className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-black tracking-tight">Virtual Football</h1>
          <p className="text-xs text-ink3">Simulated matches · new games every 3 minutes</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {FIXTURES.map((f) => (
          <div key={f.home} className="card p-4">
            <div className="flex items-center justify-between text-xs text-ink3">
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="live-dot" /> Virtual · {f.minute}
              </span>
              <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">Simulation</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <TeamRow name={f.home} />
                <TeamRow name={f.away} />
              </div>
              <span className="shrink-0 text-lg font-extrabold tabular-nums">{f.score}</span>
              <div className="grid shrink-0 grid-cols-3 gap-1.5">
                {f.odds.map((o, i) => (
                  <span key={i} className="flex h-9 w-12 items-center justify-center rounded-lg bg-[#0d1a2c] text-xs font-bold text-ink2">
                    {o}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-card p-6 text-center text-sm text-ink2">
        Virtual sports engine is next on the roadmap — these fixtures are preview only.
      </div>
    </div>
  );
}

function TeamRow({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
        <span className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-brand to-emerald-700" />
      </span>
      <span className="truncate text-sm font-semibold">{name}</span>
    </span>
  );
}
