"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import {
  IconLive,
  IconLightning,
  IconWallet,
  IconArrowDown,
  IconArrowUp,
  IconTicket,
  IconGift,
  IconHelp,
  IconMoon,
  IconSun,
  IconFlag,
  IconChevronRight,
  IconCrown,
  IconDice,
} from "@/components/icons";

const SPORT_LINKS = [
  { href: "/live", label: "Live Games", Icon: IconLive },
  { href: "/vfootball", label: "vFootball", Icon: IconLightning },
  { href: "/account/deposit", label: "Deposit", Icon: IconArrowDown },
  { href: "/account/withdraw", label: "Withdraw", Icon: IconArrowUp },
  { href: "/account/bets", label: "My Bets", Icon: IconTicket },
  { href: "/account", label: "Refer & Earn", Icon: IconGift },
];

const TOP_LEAGUES = [
  { name: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", href: "/sports/football" },
  { name: "Championship", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", href: "/sports/football" },
  { name: "La Liga", flag: "🇪🇸", href: "/sports/football" },
];

export default function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <div className={`fixed inset-0 z-[70] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Off-canvas drawer from the left */}
      <aside
        className={`absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col bg-[#0d1726] shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-lg font-black text-[#052e16]">
            V
          </span>
          <div className="min-w-0">
            <div className="truncate text-base font-extrabold tracking-tight">VoltBet</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink3">Menu</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:border-line2 hover:text-ink"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto pb-6">
          {/* Sports links */}
          <nav className="px-3 pt-3">
            {SPORT_LINKS.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={label}
                  href={href}
                  onClick={onClose}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${
                    active ? "bg-brand/10 text-brand" : "text-ink2 hover:bg-white/5 hover:text-ink"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                  <IconChevronRight className="ml-auto h-4 w-4 text-ink3" />
                </Link>
              );
            })}
          </nav>

          {/* Top leagues */}
          <div className="mt-5 px-3">
            <div className="flex items-center gap-2 px-3 pb-2">
              <IconCrown className="h-4 w-4 text-warn" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink3">Top Leagues</span>
            </div>
            {TOP_LEAGUES.map((l) => (
              <Link
                key={l.name}
                href={l.href}
                onClick={onClose}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink2 transition-colors hover:bg-white/5 hover:text-ink"
              >
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-white/5 text-sm">
                  {l.flag}
                </span>
                {l.name}
                <IconChevronRight className="ml-auto h-4 w-4 text-ink3" />
              </Link>
            ))}
          </div>

          {/* Footer links */}
          <div className="mt-6 border-t border-line px-3 pt-4">
            <div className="space-y-1">
              <Link href="/promotions" onClick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink2 hover:bg-white/5 hover:text-ink">
                <IconDice className="h-5 w-5" /> Promotions
              </Link>
              <Link href="/responsible-gambling" onClick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink2 hover:bg-white/5 hover:text-ink">
                <IconHelp className="h-5 w-5" /> Help &amp; Support
              </Link>
              <Link href="/terms" onClick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink2 hover:bg-white/5 hover:text-ink">
                <IconFlag className="h-5 w-5" /> Terms &amp; Conditions
              </Link>
            </div>
          </div>
        </div>

        {/* Dark theme toggle pinned at the bottom */}
        <div className="border-t border-line px-4 py-4">
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink2">
              {theme === "dark" ? <IconMoon className="h-5 w-5" /> : <IconSun className="h-5 w-5" />}
              Dark Theme
            </span>
            <button
              role="switch"
              aria-checked={theme === "dark"}
              aria-label="Toggle dark theme"
              onClick={toggle}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                theme === "dark" ? "bg-brand" : "bg-line2"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  theme === "dark" ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          <p className="mt-3 text-center text-[10px] text-ink3">18+ · Play responsibly</p>
        </div>
      </aside>
    </div>
  );
}
