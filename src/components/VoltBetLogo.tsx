/**
 * VoltBet brand logo — dynamic brand-primary green highlights.
 *
 * A "V" badge + wordmark where the brand color flows from the admin
 * branding setting (--vb-primary, default #00e676) via the `brand` token,
 * so it re-colors with the theme engine in both dark and light mode.
 */
export default function VoltBetLogo({ className }: { className?: string }) {
  return (
    <span className={`flex shrink-0 items-center gap-2 ${className ?? ""}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-[#052e16] shadow-[0_0_16px_rgba(0,230,118,0.35)]">
        V
      </span>
      <span className="text-lg font-extrabold tracking-tight text-primary-text">
        Volt<span className="text-brand">Bet</span>
      </span>
    </span>
  );
}
