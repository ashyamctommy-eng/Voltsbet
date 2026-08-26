import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { convert, formatMoney } from "@/lib/currency";
import { BetSlipProvider, ToastProvider } from "@/components/BetSlipContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { DrawerProvider } from "@/components/DrawerProvider";
import I18nSync from "@/components/I18nSync";
import Header, { HeaderUser } from "@/components/Header";
import Footer from "@/components/Footer";
import MobileNav from "@/components/MobileNav";
import SupportWidget from "@/components/SupportWidget";
import BetSlip from "@/components/BetSlip";
import BroadcastBanner from "@/components/BroadcastBanner";
import VoltBetSplashLoader from "@/components/VoltBetSplashLoader";

export const metadata: Metadata = {
  title: { default: "VoltBet — Sports Betting", template: "%s | VoltBet" },
  description: "Fast odds, live betting and instant crypto deposits.",
};
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
    prisma.game.count({ where: { status: { in: ["LIVE", "HALF_TIME"] } } }),
    prisma.sport.findMany({ where: { active: true }, orderBy: [{ isPopular: "desc" }, { sortOrder: "asc" }], take: 8 }),
  ]);

  let headerUser: HeaderUser = null;
  if (user) {
    const [wallet, unread] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: user.id } }),
      prisma.notification.count({ where: { OR: [{ userId: user.id }, { userId: null }], read: false } }),
    ]);
    // Wallet balance → user's display currency when set, else the platform's
    // admin-configured default operating currency (settings.currencyDefault).
    const displayCur = user.displayCurrencyCode ?? s.currencyDefault;
    const balance = wallet ? await convert(Number(wallet.balance), wallet.currencyCode, displayCur) : 0;
    headerUser = {
      username: user.username,
      role: user.role,
      currencyCode: displayCur,
      balanceLabel: await formatMoney(balance, displayCur, { compact: true }),
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
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen">
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
                  <BetSlip />
                </DrawerProvider>
              </BetSlipProvider>
            </ToastProvider>
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
