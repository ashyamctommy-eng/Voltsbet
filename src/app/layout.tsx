import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getSettings } from "@/lib/settings";
import { onBrandColor, brandTextColor } from "@/lib/brand-contrast";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { liveFeedWhere } from "@/lib/live-feed";
import { formatMoney } from "@/lib/currency";
import { BetSlipProvider, ToastProvider } from "@/components/BetSlipContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { DrawerProvider } from "@/components/DrawerProvider";
import { SiteSettingsProvider } from "@/components/SiteSettingsContext";
import I18nSync from "@/components/I18nSync";
import Header, { HeaderUser } from "@/components/Header";
import Footer from "@/components/Footer";
import MobileNav from "@/components/MobileNav";
import { existsSync } from "fs";
import { join } from "path";
import SupportWidget from "@/components/SupportWidget";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import BetSlip from "@/components/BetSlip";
import BroadcastBanner from "@/components/BroadcastBanner";
import VoltBetSplashLoader from "@/components/VoltBetSplashLoader";

/** White-label metadata — every brand string comes from the DB settings
 *  (Admin → Website Settings → Branding), never a build-time constant. */
export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const brand = s.siteName || "Sportsbook";
  // Per-client icon set. The files live OUTSIDE the repo — nginx serves them
  // from BRANDING_DIR — so they stay client-specific and survive a rebuild.
  // Only advertise them when they are actually present: an install with no
  // branding dir keeps Next's built-in favicon instead of linking 404s.
  // Evaluated per request, so dropping the files in needs no code change.
  const brandingDir = process.env.BRANDING_DIR || "/var/www/voltsbet-branding";
  let hasIcons = false;
  try {
    hasIcons = existsSync(join(brandingDir, "favicon.ico"));
  } catch {
    /* non-Node runtime or unreadable path — fall back to the built-in icon */
  }
  return {
    title: {
      default: `${brand} — Sports Betting`,
      template: `%s | ${brand}`,
    },
    description: s.tagline || "Fast odds, live betting and instant crypto deposits.",
    ...(hasIcons
      ? {
          icons: {
            icon: [
              { url: "/favicon.ico", sizes: "48x48" },
              { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
            ],
            apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
          },
          manifest: "/site.webmanifest",
        }
      : {}),
  };
}
export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
  // Lock viewport zoom on mobile — pinch + double-tap zoom disabled (the app
  // is a native-feel sportsbook; text-size adjust is also neutralized).
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [s, user, liveGames, sports] = await Promise.all([
    getSettings(),
    getCurrentUser(),
    // Canonical live-feed predicate — identical to the /live header count and
    // the rendered cards (see src/lib/live-feed.ts).
    prisma.game.count({ where: liveFeedWhere() }),
    prisma.sport.findMany({ where: { active: true }, orderBy: [{ isPopular: "desc" }, { sortOrder: "asc" }], take: 8 }),
  ]);

  // ── Maintenance gate (DB toggle from Admin → Website Settings) ──────────
  // Staff see the real site, and the auth/admin surfaces stay reachable so an
  // admin can sign in and switch maintenance back OFF without a redeploy.
  // The env kill-switch (MAINTENANCE_MODE) also lands here via getSettings,
  // and is enforced independently in proxy.ts for the DB-down case.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isStaff = !!user && user.role !== "CUSTOMER";
  const maintenanceExempt =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/maintenance" ||
    pathname.startsWith("/admin");
  if (s.maintenanceEnabled && !isStaff && !maintenanceExempt) {
    return (
      <html
        lang="en"
        style={
          {
            "--vb-primary": s.primaryColor,
            "--vb-secondary": s.secondaryColor,
            "--vb-accent": s.accentColor,
            "--vb-on-brand": onBrandColor(s.primaryColor),
            "--vb-on-accent": onBrandColor(s.accentColor),
            // Base surface tint (proposal 05) — the setting existed but nothing
            // read it. Dark-only: the light theme pins its own surfaces.
            "--vb-base-dark": s.secondaryColor,
            // Brand-as-text for BOTH themes, resolved up front because the theme
            // is chosen client-side after hydration (proposal 02).
            "--vb-brand-text-dark": brandTextColor(s.primaryColor, "#0b0e14"),
            "--vb-brand-text-light": brandTextColor(s.primaryColor, "#ffffff"),
          } as React.CSSProperties
        }
      >
        <body className="min-h-screen">
          <MaintenanceScreen brand={s.siteName} message={s.maintenanceMessage} />
        </body>
      </html>
    );
  }

  let headerUser: HeaderUser = null;
  if (user) {
    const [wallet, unread] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: user.id } }),
      prisma.notification.count({ where: { OR: [{ userId: user.id }, { userId: null }], read: false } }),
    ]);
    // Wallet-currency policy: every balance surface (header, betslip, floating
    // bar, wallet) shows the user's WALLET currency with its RAW balance —
    // never a display-currency conversion. A converted header (e.g. a KES
    // wallet shown as "$4") made the betslip look like it was "in another
    // currency" when it was actually the only correct one.
    const walletCur = wallet?.currencyCode ?? user.currencyCode ?? s.currencyDefault;
    headerUser = {
      username: user.username,
      role: user.role,
      currencyCode: walletCur,
      balanceLabel: await formatMoney(Number(wallet?.balance ?? 0), walletCur, { compact: true }),
      bonusLabel: await formatMoney(Number(wallet?.bonusBalance ?? 0), walletCur, { compact: true }),
      hasDeposited: user.hasDeposited,
      unreadNotifications: unread,
    };
  }

  return (
    <html
      lang="en"
      style={
        {
          "--vb-primary": s.primaryColor,
          "--vb-secondary": s.secondaryColor,
          "--vb-accent": s.accentColor,
          "--vb-on-brand": onBrandColor(s.primaryColor),
          "--vb-on-accent": onBrandColor(s.accentColor),
          // Base surface tint (proposal 05) — the setting existed but nothing
          // read it. Dark-only: the light theme pins its own surfaces.
          "--vb-base-dark": s.secondaryColor,
          // Brand-as-text for BOTH themes, resolved up front because the theme
          // is chosen client-side after hydration (proposal 02).
          "--vb-brand-text-dark": brandTextColor(s.primaryColor, "#0b0e14"),
          "--vb-brand-text-light": brandTextColor(s.primaryColor, "#ffffff"),
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen">
        {/* Pre-paint theme bootstrap: flips <html data-theme> before first
            paint so returning users never flash the wrong theme while React
            hydrates (the provider itself hydrates with the stable default). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("voltbet-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}}catch(e){}`,
          }}
        />
        <SiteSettingsProvider siteName={s.siteName} tagline={s.tagline} betSlipAutoOpen={s.betSlipAutoOpen}>
          <ThemeProvider>
            <I18nSync />
            <CurrencyProvider>
              <ToastProvider>
                <BetSlipProvider>
                  <DrawerProvider
                    isStaff={!!user && user.role !== "CUSTOMER"}
                    support={{
                      whatsappEnabled: s.whatsappEnabled,
                      whatsapp: s.whatsapp,
                      telegramEnabled: s.telegramEnabled,
                      telegram: s.telegram,
                    }}
                  >
                    <VoltBetSplashLoader />
                    <BroadcastBanner />
                    <Header user={headerUser} siteName={s.siteName} sports={sports} />
                    {/* Mobile bottom padding clears the bottom nav (~64px) plus the
                        floating yellow betslip bar (sits at 62px, ~56px tall). */}
                    <main className="min-h-[60vh] pb-32 xl:pb-0">{children}</main>
                    <Footer />
                    <MobileNav loggedIn={!!user} liveCount={liveGames} />
                    <SupportWidget
                      isStaff={!!user && user.role !== "CUSTOMER"}
                      support={{
                        phone: s.supportPhone,
                        whatsappEnabled: s.whatsappEnabled,
                        whatsapp: s.whatsapp,
                        telegramEnabled: s.telegramEnabled,
                        telegram: s.telegram,
                      }}
                    />
                    <ScrollToTopButton />
                    <BetSlip />
                  </DrawerProvider>
                </BetSlipProvider>
              </ToastProvider>
            </CurrencyProvider>
          </ThemeProvider>
        </SiteSettingsProvider>
      </body>
    </html>
  );
}
