/**
 * Global sponsor & payment-provider footer banner — a trust strip above the
 * copyright bar. Pure static markup (text badges; no external assets), so it
 * renders on every page and never blocks SSR.
 *
 * Layout: dark green band → federation/sports icons row, payment row,
 * then the copyright line. Bottom padding keeps it clear of the fixed
 * mobile bottom navigation.
 */
const FEDERATIONS = ["UEFA", "UFC", "WTA", "FIBA", "NHL", "ATP", "ITF", "FIFA"];
const PAYMENTS = [
  "VISA",
  "Mastercard",
  "Apple Pay",
  "Google Pay",
  "Samsung Pay",
  "Bitcoin",
  "Ethereum",
  "Tether",
  "TRON",
  "Skrill",
  "Payeer",
];

export default function FooterBanner() {
  return (
    <div className="border-t border-white/5 bg-[#0a2212] px-4 py-6 text-white/70 sm:px-6">
      {/* Federation strip */}
      <div className="mx-auto max-w-[1600px]">
        <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300/70">
          Official sports partners
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {FEDERATIONS.map((f) => (
            <span
              key={f}
              className="rounded-md border border-emerald-300/20 bg-emerald-300/5 px-3 py-1.5 text-xs font-black tracking-wide text-emerald-100/90"
            >
              {f}
            </span>
          ))}
        </div>

        {/* Payment providers strip */}
        <p className="mb-2 mt-5 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300/70">
          Payment providers
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {PAYMENTS.map((p) => (
            <span
              key={p}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/80"
            >
              {p}
            </span>
          ))}
        </div>

        <p className="mt-5 text-center text-[11px] font-medium text-white/50">
          Copyright © 2026. All rights reserved.
        </p>
      </div>
    </div>
  );
}
