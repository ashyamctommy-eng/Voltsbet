"use client";

import { useSiteName } from "@/components/SiteSettingsContext";

/**
 * White-label site logo — badge letter + wordmark both come from the
 * DB-driven site name (Admin → Website Settings → Branding), falling back
 * to the server-injected SiteSettingsProvider value.
 *
 * The `name` prop lets server components (e.g. the Footer) pin the exact
 * brand on first paint without waiting for client hydration.
 */
export default function VoltBetLogo({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const siteName = useSiteName();
  const brand = (name ?? siteName ?? "").trim() || "Sportsbook";
  const badge = brand.charAt(0).toUpperCase();

  // Two-tone wordmark. A white-label book often has no logo and no favicon, so
  // the name itself has to carry the identity — and a brand that ends in digits
  // ("Unibet360", "Bet365") gives it a natural split to colour. Generic on
  // purpose: any trailing digits get the theme-aware brand ink, so it stays
  // legible in dark AND light (text-brand-text flips with the theme) and needs
  // no extra setting. A name without trailing digits renders unchanged.
  const m = /^(.*\D)(\d+)$/.exec(brand);
  const head = m ? m[1] : brand;
  const tail = m ? m[2] : "";

  return (
    <span className={`flex shrink-0 items-center gap-2 ${className ?? ""}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-on-brand shadow-[0_0_16px_rgba(0,230,118,0.35)]">
        {badge}
      </span>
      <span className="text-lg font-extrabold tracking-tight text-primary-text">
        {head}
        {tail && <span className="text-brand-text">{tail}</span>}
      </span>
    </span>
  );
}
