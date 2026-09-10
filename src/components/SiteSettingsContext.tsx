"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";

/**
 * Client-side site/brand settings — the single dynamic source of truth for
 * every white-label string in the UI (site name, tagline, …).
 *
 * The value is SEEDED by the server root layout from the DB
 * (Admin → Website Settings) so first paint matches the configured brand,
 * and `refresh()` re-fetches `/api/public/settings` after an admin save so
 * the running app re-brands immediately — no reload required.
 */
export type SiteBrand = { siteName: string; tagline: string };

/** Behaviour flags that client components need (not just branding). */
export type SiteBehaviour = { betSlipAutoOpen: boolean };

/** Server-seeded data (everything except the fetch refresh function). */
type SiteData = SiteBrand & SiteBehaviour;

type SiteSettingsValue = SiteBrand & SiteBehaviour & {
  /** Re-fetch branding from the server — call after settings are saved. */
  refresh: () => Promise<void>;
};

const Ctx = createContext<SiteSettingsValue>({
  siteName: "",
  tagline: "",
  betSlipAutoOpen: false,
  refresh: async () => {},
});

export function SiteSettingsProvider({
  siteName,
  tagline,
  betSlipAutoOpen = false,
  children,
}: {
  siteName: string;
  tagline: string;
  /** Seeded from the DB by the root layout. */
  betSlipAutoOpen?: boolean;
  children: React.ReactNode;
}) {
  const [brand, setBrand] = useState<SiteData>({ siteName, tagline, betSlipAutoOpen });

  const refresh = useCallback(async () => {
    const res = await apiFetch<SiteBrand & Partial<SiteBehaviour>>("/api/public/settings");
    if (!res.ok) return;
    setBrand((prev) => ({
      ...prev,
      siteName: res.data.siteName?.trim() || prev.siteName,
      tagline: res.data.tagline ?? prev.tagline,
      betSlipAutoOpen: res.data.betSlipAutoOpen ?? prev.betSlipAutoOpen,
    }));
  }, []);

  const value = useMemo(() => ({ ...brand, refresh }), [brand, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Full brand settings (siteName, tagline) + refresh(). */
export function useSiteSettings(): SiteSettingsValue {
  return useContext(Ctx);
}

/** The current dynamic site name — falls back to "" before hydration. */
export function useSiteName(): string {
  return useContext(Ctx).siteName;
}
