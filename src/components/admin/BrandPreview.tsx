"use client";

/**
 * Live brand preview for Admin → Settings → Branding.
 *
 * Renders the pieces a customer actually sees — the sport tabs, the promo
 * banner, the market pills, the 1×2 odds grid, the primary button — using the
 * UNSAVED values from the form, so an admin sees the consequence of a hex code
 * before committing to it. Everything inside the frame is painted with the
 * candidate colours by overriding --vb-primary / --vb-accent / --vb-on-brand
 * on the wrapper, which means the real utility classes (bg-brand, text-on-brand,
 * bg-accent, border-line…) do the drawing: the preview cannot drift from the app.
 *
 * Two honesty rules, both learned the hard way:
 *  1. Show what the brand does NOT control. The hero promo banner is fixed
 *     artwork (hardcoded orange gradient in PromoBanner.tsx) — it is drawn as-is
 *     and labelled, so nobody picks a violet brand expecting a violet banner.
 *  2. The on-brand ink is computed (see lib/brand-contrast), not fixed. The
 *     preview shows the same contrast the real buttons will use.
 */

import { useMemo } from "react";
import { onBrandColor } from "@/lib/brand-contrast";

type Template = { name: string; primary: string; accent: string; note: string };

/** The shipped client palettes — one click sets both brand hues. */
export const BRAND_TEMPLATES: Template[] = [
  { name: "Volt Green", primary: "#00e676", accent: "#7c3aed", note: "Current default — high energy" },
  { name: "Sapphire", primary: "#4f7cff", accent: "#22d3ee", note: "Cool, institutional, trustworthy" },
  { name: "Royal Violet", primary: "#8b5cf6", accent: "#ec4899", note: "Premium, nightlife" },
  { name: "Aqua Teal", primary: "#14b8a6", accent: "#6366f1", note: "Fintech calm, low clutter" },
  { name: "Citrus Lime", primary: "#a3e635", accent: "#10b981", note: "Loud, youthful, promo-driven" },
  { name: "Sunset", primary: "#fb923c", accent: "#f43f5e", note: "Warm, bold, ad-friendly" },
];

/**
 * Colours the app already uses to mean something. A brand in one of these hues
 * makes losing bets or warnings look like brand chrome, so we warn rather than
 * silently ship it. Matched by distance, not equality, because near-misses look
 * just as wrong.
 */
const SEMANTIC = [
  { hex: "#ef4444", label: "losses / down", dist: 64 },
  { hex: "#f59e0b", label: "warnings", dist: 64 },
  { hex: "#3b82f6", label: "system info", dist: 40 },
] as const;

function rgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function distance(a: string, b: string): number {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return 999;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

const isHex = (v: string) => rgb(v) !== null;

export default function BrandPreview({
  primary,
  accent,
  siteName,
  onApply,
}: {
  primary: string;
  accent: string;
  siteName: string;
  onApply: (primary: string, accent: string) => void;
}) {
  const primaryOk = isHex(primary);
  const accentOk = isHex(accent);

  // Preview with something sane when a field is mid-edit ("#", "00e6"…), but
  // never claim it's the saved value.
  const p = primaryOk ? primary : "#00e676";
  const a = accentOk ? accent : "#7c3aed";
  const ink = useMemo(() => onBrandColor(p), [p]);

  const clashes = useMemo(
    () =>
      SEMANTIC.filter((s) => primaryOk && distance(p, s.hex) < s.dist).map(
        (s) => `${s.hex} is the app's ${s.label} colour`,
      ),
    [p, primaryOk],
  );

  const vars = {
    "--vb-primary": p,
    "--vb-accent": a,
    "--vb-on-brand": ink,
  } as React.CSSProperties;

  const brand = siteName.trim() || "YourBrand";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-ink2">Live preview</span>
        <span className="text-[11px] text-ink3">
          {primaryOk ? p : "—"} on {ink === "#ffffff" ? "white" : "dark"} text
        </span>
      </div>

      {/* ── the device frame: everything inside resolves brand tokens ── */}
      <div style={vars} className="rounded-2xl border border-line bg-panel-bg p-3">
        {/* sport tabs — active chip follows the brand */}
        <div className="flex gap-1.5">
          {[
            { label: "Football", emoji: "⚽", on: true },
            { label: "Basketball", emoji: "🏀", on: false },
            { label: "Tennis", emoji: "🎾", on: false },
          ].map((s) => (
            <span
              key={s.label}
              className={`flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-bold ${
                s.on ? "bg-brand text-on-brand" : "bg-card text-ink2"
              }`}
            >
              <span aria-hidden>{s.emoji}</span>
              {s.label}
            </span>
          ))}
          {/* the 4th sport in the app is deliberately orange — not brand-driven */}
          <span className="flex flex-1 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 px-2 py-2 text-[11px] font-bold text-[#3a1f00]">
            Aviator
          </span>
        </div>

        {/* search */}
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
          <span className="text-ink3" aria-hidden>⌕</span>
          <span className="text-[11px] text-ink3">Search teams, leagues…</span>
        </div>

        {/* promo banner — FIXED artwork, not brand-driven (labelled below) */}
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 px-3 py-2.5">
          <span aria-hidden className="text-base">🎁</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-black text-orange-950">10% Daily Cashback</div>
            <div className="truncate text-[10px] font-semibold text-orange-950/80">
              Receive 10% cashback on daily losses
            </div>
          </div>
          <span className="shrink-0 rounded-lg bg-orange-100/90 px-2.5 py-1 text-[10px] font-black text-orange-950">
            Deposit
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/85 text-[11px] text-orange-900" aria-hidden>
            🎁
          </span>
        </div>

        {/* filter tabs — active underline + pill follow the brand */}
        <div className="mt-3 flex items-center gap-2 border-b border-line pb-2">
          <span className="text-[11px] text-ink3">Highlights</span>
          <span className="relative text-[11px] font-bold text-ink">
            Upcoming
            <span className="absolute -bottom-2 left-0 right-0 h-0.5 rounded-full bg-brand" />
          </span>
          <span className="text-[11px] text-ink3">Today ▾</span>
          <span className="text-[11px] text-ink3">Leagues ▾</span>
        </div>

        {/* market pills — the classic bg-brand + on-brand ink pairing */}
        <div className="mt-2 flex gap-1.5 overflow-hidden">
          {["1×2 / Winner", "Double Chance", "Both Teams"].map((m, i) => (
            <span
              key={m}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${
                i === 0 ? "bg-brand text-on-brand" : "bg-card text-ink2"
              }`}
            >
              {m}
            </span>
          ))}
        </div>

        {/* 1 / X / 2 grid + one match row */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {["1", "X", "2"].map((h) => (
            <span key={h} className="text-center text-[10px] font-bold text-ink3">
              {h}
            </span>
          ))}
        </div>
        <div className="mt-1 rounded-xl border border-line bg-card p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] font-bold text-bad">● LIVE</span>
            <span className="text-[10px] text-ink3">67&apos;</span>
            <span className="ml-auto text-[10px] text-ink3">Premier League</span>
          </div>
          <div className="mb-1.5 text-[11px] text-ink">Arsenal&nbsp;&nbsp;2 – 1&nbsp;&nbsp;Chelsea</div>
          <div className="grid grid-cols-3 gap-1.5">
            {/* selected odds carry the brand fill — the most brand-defining element */}
            <span className="rounded-lg bg-brand px-2 py-1.5 text-center text-[11px] font-bold text-on-brand">
              1.72
            </span>
            <span className="rounded-lg bg-card2 px-2 py-1.5 text-center text-[11px] font-bold text-ink">
              3.40
            </span>
            <span className="rounded-lg bg-card2 px-2 py-1.5 text-center text-[11px] font-bold text-ink">
              4.85
            </span>
          </div>
        </div>

        {/* primary + accent actions side by side */}
        <div className="mt-2 flex gap-2">
          <span className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-[11px] font-bold text-on-brand">
            Place bet · KES 500
          </span>
          <span className="rounded-lg bg-accent px-3 py-2 text-center text-[11px] font-bold text-white">
            Boost
          </span>
        </div>

        {/* header/logo wordmark in brand */}
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand text-[10px] font-black text-on-brand">
            {brand.charAt(0).toUpperCase()}
          </span>
          <span className="text-[11px] font-black text-brand-text">{brand.toUpperCase()}</span>
          <span className="ml-auto text-[10px] text-ink3">KES 12,480</span>
        </div>
      </div>

      {/* ── what the brand does NOT touch ── */}
      <p className="text-[11px] leading-relaxed text-ink3">
        The <b className="text-ink2">orange cashback banner</b> is fixed promotional artwork
        (hardcoded in <code>PromoBanner.tsx</code>), as is the orange <b className="text-ink2">Aviator</b> sport
        chip. Your brand colours drive the primary buttons, selected odds, active pills and
        tabs, the logo, and the accent button.
      </p>

      {/* ── clash warning ── */}
      {clashes.length > 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-500">
          ⚠ This primary colour is very close to a colour the app already uses for meaning —{" "}
          {clashes.join("; ")}. Losing bets and warnings will look like brand elements. Safer
          hues: green, teal, cyan, violet, pink, orange.
        </p>
      )}
      {!primaryOk && primary !== "" && (
        <p className="text-[11px] font-semibold text-bad">
          “{primary}” isn&apos;t a valid hex colour — the preview is showing the default.
        </p>
      )}
      {!accentOk && accent !== "" && (
        <p className="text-[11px] font-semibold text-bad">
          “{accent}” isn&apos;t a valid hex colour — the preview is showing the default.
        </p>
      )}

      {/* ── one-click templates ── */}
      <div className="space-y-2 rounded-xl border border-line bg-card p-3">
        <div className="text-xs font-bold text-ink2">Client templates</div>
        <div className="flex flex-wrap gap-1.5">
          {BRAND_TEMPLATES.map((t) => {
            const active = primaryOk && t.primary.toLowerCase() === p.toLowerCase();
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => onApply(t.primary, t.accent)}
                title={`${t.note} — primary ${t.primary}, accent ${t.accent}`}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                  active
                    ? "border-brand bg-brand/10 text-ink"
                    : "border-line text-ink2 hover:border-line2 hover:text-ink"
                }`}
              >
                <span className="flex gap-0.5" aria-hidden>
                  <span className="h-3 w-3 rounded-full border border-black/20" style={{ background: t.primary }} />
                  <span className="h-3 w-3 rounded-full border border-black/20" style={{ background: t.accent }} />
                </span>
                {t.name}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-ink3">
          Sets both colours in the form — press <b className="text-ink2">Save</b> to publish.
          For a new client install, the same palette goes in as{" "}
          <code className="text-ink2">BRAND_COLOR</code> / <code className="text-ink2">BRAND_ACCENT</code>.
        </p>
      </div>
    </div>
  );
}
