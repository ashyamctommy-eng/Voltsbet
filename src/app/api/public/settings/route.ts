import { handle, ok } from "@/lib/api";
import { getSettings } from "@/lib/settings";

/** Public branding subset for the client SiteSettingsProvider (no auth).
 *  force-dynamic: never serve a stale cached brand — a site rename must
 *  propagate the moment it is saved. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = handle(async () => {
  const s = await getSettings();
  return ok({ siteName: s.siteName, tagline: s.tagline });
});
