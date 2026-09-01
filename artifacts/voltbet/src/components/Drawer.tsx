"use client";

import { Link, useLocation } from "wouter";
import LanguageSelector from "@/components/LanguageSelector";
import { useTheme } from "@/components/ThemeProvider";
import {
  IconLive,
  IconArrowDown,
  IconArrowUp,
  IconTicket,
  IconGift,
  IconHelp,
  IconMoon,
  IconSun,
  IconChevronRight,
  IconCrown,
  IconWhatsApp,
  IconTelegram,
  IconCalendar,
  IconUsers,
  IconDownload,
  IconUpload,
  IconCoins,
  IconGear,
  IconPlug,
  IconController,
} from "@/components/icons";

export type SupportLinks = {
  whatsappEnabled: boolean;
  whatsapp: string;
  telegramEnabled: boolean;
  telegram: string;
};

type MenuItem = { href: string; label: string; Icon: (p: { className?: string }) => React.ReactNode; color: string; badge?: string };

/* Color-coded menu items (matches the SafiBets drawer hierarchy).
 * Colors use `dark:` pairs so the pale icon tints (sky-100/300, amber-300…)
 * only apply in dark mode — in light mode they flip to 600-level shades that
 * hold contrast on white (#f4f6f8). */
const CUSTOMER_ITEMS: MenuItem[] = [
  { href: "/live", label: "Live Games", Icon: IconLive, color: "dark:text-red-400 text-red-600", badge: "LIVE" },
  { href: "/account/deposit", label: "Deposit", Icon: IconArrowDown, color: "dark:text-green-400 text-green-600" },
  { href: "/account/withdraw", label: "Withdraw", Icon: IconArrowUp, color: "dark:text-sky-300 text-sky-600" },
  { href: "/account/bets", label: "My Bets", Icon: IconTicket, color: "dark:text-sky-100 text-sky-600" },
  { href: "/account", label: "Refer & Earn", Icon: IconGift, color: "dark:text-purple-400 text-purple-600" },
];

/* Staff drawer — admin features, not customer features */
const STAFF_ITEMS: MenuItem[] = [
  { href: "/admin/games", label: "Manage Games", Icon: IconCalendar, color: "dark:text-green-400 text-green-600" },
  { href: "/admin/users", label: "Users Management", Icon: IconUsers, color: "dark:text-sky-300 text-sky-600" },
  { href: "/admin/deposits", label: "Crypto Transactions", Icon: IconDownload, color: "dark:text-amber-300 text-amber-600" },
  { href: "/admin/withdrawals", label: "Withdrawals", Icon: IconUpload, color: "dark:text-sky-100 text-sky-600" },
  { href: "/admin/vouchers", label: "Vouchers", Icon: IconGift, color: "dark:text-yellow-300 text-yellow-600" },
  { href: "/admin/settings#payments", label: "Payments", Icon: IconCoins, color: "dark:text-purple-400 text-purple-600" },
  { href: "/admin/api-settings", label: "API Settings — The Odds API (v4)", Icon: IconPlug, color: "dark:text-green-400 text-green-600" },
  { href: "/admin/settings", label: "Website Settings", Icon: IconGear, color: "text-ink2" },
  { href: "/admin/ops", label: "Daily Ops", Icon: IconController, color: "dark:text-cyan-300 text-cyan-600" },
];

const TOP_LEAGUES = [
  { name: "Premier League", href: "/sports/football", Flag: EnglandFlag },
  { name: "Championship", href: "/sports/football", Flag: EnglandFlag },
  { name: "La Liga", href: "/sports/football", Flag: SpainFlag },
];

export default function Drawer({
  open,
  onClose,
  support,
  isStaff = false,
}: {
  open: boolean;
  onClose: () => void;
  support: SupportLinks;
  isStaff?: boolean;
}) {
  const [pathname] = useLocation();
  const { theme, toggle } = useTheme();
  const showWhatsApp = support.whatsappEnabled && !!support.whatsapp;
  const showTelegram = support.telegramEnabled && !!support.telegram;
  const items = isStaff ? STAFF_ITEMS : CUSTOMER_ITEMS;

  return (
    <div className={`fixed inset-0 z-[70] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />

      {/* Off-canvas drawer from the left */}
      <aside
        className={`absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col bg-panel-bg shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-lg font-black text-[#052e16]">U</span>
          <div className="min-w-0">
            <div className="truncate text-base font-extrabold tracking-tight">UNIBET360</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink3">Menu</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSelector />
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:border-line2 hover:text-ink"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto pb-6">
          {/* Sports section */}
          <nav className="px-3 pt-4">
            <h3 className="px-2 pb-2 text-sm font-black text-ink">{isStaff ? "Admin" : "Sports"}</h3>
            <div className="space-y-1.5">
              {items.map(({ href, label, Icon, color, badge }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={label}
                    href={href}
                    onClick={onClose}
                    className={`flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-sm font-bold transition-transform active:scale-[0.98] ${
                      color
                    } ${active ? "ring-1 ring-brand/40" : ""}`}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                    {badge && (
                      <span className="ml-auto rounded-md bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white">{badge}</span>
                    )}
                    <IconChevronRight className="ml-auto h-4 w-4 opacity-40" />
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Top leagues (customer drawer only) */}
          {!isStaff && (
          <div className="mt-6 px-3">
            <h3 className="flex items-center gap-2 px-2 pb-2 text-sm font-black text-ink">
              <IconCrown className="h-4 w-4 text-warn" /> Top Leagues
            </h3>
            <div className="space-y-1.5">
              {TOP_LEAGUES.map((l) => (
                <Link
                  key={l.name}
                  href={l.href}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-sm font-semibold text-ink2 transition-colors hover:text-ink"
                >
                  <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-hover-tint">
                    <l.Flag className="h-4 w-5" />
                  </span>
                  {l.name}
                  <IconChevronRight className="ml-auto h-4 w-4 opacity-40" />
                </Link>
              ))}
            </div>
          </div>
          )}

          {/* Community & support */}
          <div className="mt-6 px-3">
            <h3 className="px-2 pb-2 text-sm font-black text-ink">Community &amp; Support</h3>
            <div className="space-y-1.5">
              {showWhatsApp && (
                <a
                  href={`https://wa.me/${support.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Hello! I need help.")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-sm font-bold dark:text-green-400 text-green-600"
                >
                  <IconWhatsApp className="h-5 w-5" /> WhatsApp
                  <IconChevronRight className="ml-auto h-4 w-4 opacity-40" />
                </a>
              )}
              {showTelegram && (
                <a
                  href={support.telegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-sm font-bold dark:text-sky-400 text-sky-600"
                >
                  <IconTelegram className="h-5 w-5" /> Telegram
                  <IconChevronRight className="ml-auto h-4 w-4 opacity-40" />
                </a>
              )}
              <Link
                href="/responsible-gambling"
                onClick={onClose}
                className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-sm font-bold text-ink2"
              >
                <IconHelp className="h-5 w-5" /> Help &amp; Support
                <IconChevronRight className="ml-auto h-4 w-4 opacity-40" />
              </Link>
            </div>
          </div>
        </div>

        {/* Pinned bottom: theme toggle */}
        <div className="border-t border-line px-4 py-4">
          <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink2">
              {theme === "dark" ? <IconMoon className="h-5 w-5" /> : <IconSun className="h-5 w-5" />}
              Dark Theme
            </span>
            <button
              role="switch"
              aria-checked={theme === "dark"}
              aria-label="Toggle dark theme"
              onClick={toggle}
              className={`relative h-6 w-11 rounded-full transition-colors ${theme === "dark" ? "bg-brand" : "bg-line2"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${theme === "dark" ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          <p className="mt-3 text-center text-[10px] text-ink3">18+ · Play responsibly</p>
        </div>
      </aside>
    </div>
  );
}

/* ── Simplified league flags (SVG) ─────────────────────────── */
function EnglandFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden>
      <rect width="60" height="40" fill="#fff" />
      <path d="M0 0h60v40H0z" fill="#CE1124" opacity="0.28" />
      <path d="M28 0h4v40h-4z" fill="#CE1124" />
      <path d="M0 18h60v4H0z" fill="#CE1124" />
    </svg>
  );
}

function SpainFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden>
      <rect width="60" height="40" fill="#C60B1E" />
      <rect y="10" width="60" height="20" fill="#FFC400" />
      <circle cx="30" cy="20" r="3.4" fill="#C60B1E" />
    </svg>
  );
}
