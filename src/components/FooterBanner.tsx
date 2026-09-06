/**
 * Global sponsor & payment-provider footer banner — a trust strip above the
 * copyright bar. Two horizontal, touch-scrollable rows of local brand logos
 * (from /public), so no external requests are made and it renders on every
 * page without blocking SSR.
 *
 * Layout: neutral footer band (matches the parent footer background) →
 * official sports partners logo row, payment providers logo row, then the
 * copyright line. Bottom padding keeps it clear of the fixed mobile bottom
 * navigation.
 *
 * Files are served as relative paths (e.g. `/fiba.svg`) straight from the
 * /public directory — case-sensitive filenames.
 */
const SPORTS_PARTNERS = [
  { src: "/fiba.svg", alt: "FIBA" },
  { src: "/fifa.svg", alt: "FIFA" },
  { src: "/ITF.svg", alt: "ITF" },
  { src: "/uefa.svg", alt: "UEFA" },
];

const PAYMENT_PROVIDERS = [
  { src: "/applepay.png", alt: "Apple Pay" },
  { src: "/BTC.png", alt: "Bitcoin" },
  { src: "/ETH.png", alt: "Ethereum" },
  { src: "/mastercard.png", alt: "Mastercard" },
  { src: "/payeer.png", alt: "Payeer" },
  { src: "/piastrix.png", alt: "Piastrix" },
  { src: "/skrill.png", alt: "Skrill" },
  { src: "/TRON.png", alt: "TRON" },
  { src: "/USDT.png", alt: "Tether (USDT)" },
];

export default function FooterBanner() {
  return (
    <div className="border-t border-line bg-panel-bg px-4 text-ink3 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-center gap-4 py-6 text-center">
        {/* Official sports partners — centered, wrapping logo row */}
        <div className="w-full">
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-ink2">
            Official sports partners
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {SPORTS_PARTNERS.map((p) => (
              <img
                key={p.src}
                src={p.src}
                alt={p.alt}
                loading="lazy"
                className="h-6 w-auto object-contain opacity-80 transition-opacity hover:opacity-100"
              />
            ))}
          </div>
        </div>

        {/* Payment providers — centered, wrapping logo row */}
        <div className="w-full">
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-ink2">
            Payment providers
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {PAYMENT_PROVIDERS.map((p) => (
              <img
                key={p.src}
                src={p.src}
                alt={p.alt}
                loading="lazy"
                className="h-6 w-auto object-contain opacity-80 transition-opacity hover:opacity-100"
              />
            ))}
          </div>
        </div>

        <p className="text-[11px] font-medium text-ink3">
          Copyright © 2026. All rights reserved.
        </p>
      </div>
    </div>
  );
}
