import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { convert, formatMoney } from "@/lib/currency";
import { BetSlipProvider, ToastProvider } from "@/components/BetSlipContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import Header, { HeaderUser } from "@/components/Header";
import Footer from "@/components/Footer";
import MobileNav from "@/components/MobileNav";
import SupportWidgets from "@/components/SupportWidgets";
import BetSlip from "@/components/BetSlip";

export const metadata: Metadata = {
  title: { default: "VoltBet — Sports Betting", template: "%s | VoltBet" },
  description: "Fast odds, live betting and instant crypto deposits.",
};
export const viewport: Viewport = { themeColor: "#0b1220", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [s, user] = await Promise.all([getSettings(), getCurrentUser()]);

  let headerUser: HeaderUser = null;
  if (user) {
    const [wallet, unread] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: user.id } }),
      prisma.notification.count({ where: { OR: [{ userId: user.id }, { userId: null }], read: false } }),
    ]);
    const displayCur = user.displayCurrencyCode ?? user.currencyCode;
    const balance = wallet ? await convert(Number(wallet.balance), wallet.currencyCode, displayCur) : 0;
    headerUser = {
      username: user.username,
      role: user.role,
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
          <ToastProvider>
            <BetSlipProvider>
              <Header
                user={headerUser}
                siteName={s.siteName}
                support={{
                  whatsappEnabled: s.whatsappEnabled,
                  whatsapp: s.whatsapp,
                  telegramEnabled: s.telegramEnabled,
                  telegram: s.telegram,
                }}
              />
              <main className="min-h-[60vh] pb-20 xl:pb-0">{children}</main>
              <Footer />
              <MobileNav loggedIn={!!user} />
              <SupportWidgets />
              <BetSlip />
            </BetSlipProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
