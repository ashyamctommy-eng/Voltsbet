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

  return (
    <span className={`flex shrink-0 items-center gap-2 ${className ?? ""}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-[#052e16] shadow-[0_0_16px_rgba(0,230,118,0.35)]">
        {badge}
      </span>
      <span className="text-lg font-extrabold tracking-tight text-primary-text">
        {brand}
      </span>
    </span>
  );
}
