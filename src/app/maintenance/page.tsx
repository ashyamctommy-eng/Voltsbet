import { getSettings } from "@/lib/settings";
import MaintenanceScreen from "@/components/MaintenanceScreen";

/**
 * Maintenance screen — reached either by the env kill-switch (proxy.ts) or the
 * DB toggle (root layout gate). Depends only on a best-effort settings read so
 * it still renders when the database is unreachable.
 */
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  let brand = "Sportsbook";
  let message = "";
  try {
    const s = await getSettings();
    brand = s.siteName || brand;
    message = s.maintenanceMessage;
  } catch {
    // DB unreachable — fall back to the generic copy.
  }

  return <MaintenanceScreen brand={brand} message={message} />;
}
