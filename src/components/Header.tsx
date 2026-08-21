"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { useDrawer } from "@/components/DrawerProvider";
import DepositModal from "@/components/DepositModal";
import LanguageSelector from "@/components/LanguageSelector";
import { useTranslation } from "react-i18next";
import {
  IconMenu,
  IconSearch,
  IconFootball,
  IconBasketball,
  IconTennis,
  IconLive,
  IconController,
  IconTv,
  IconWallet,
  IconUser,
} from "@/components/icons";

export type HeaderUser = {
  username: string;
  role: string;
  currencyCode: string;
  balanceLabel: string;
  unreadNotifications: number;
} | null;

const CATEGORY_TABS = [
  { label: "Football", href: "/sports/football", Icon: IconFootball },
  { label: "Basketball", href: "/sports/basketball", Icon: IconBasketball },
  { label: "Tennis", href: "/sports/tennis", Icon: IconTennis },
  { labelKey: "nav.live", label: "Live", href: "/live", Icon: IconLive },
  { label: "Esports", href: "/sports/esports", Icon: IconController },
  { label: "Cricket", href: "/sports/cricket", Icon: IconTv },
];

const DESKTOP_NAV = [
  { labelKey: "nav.home", label: "Home", href: "/", exact: true },
  { labelKey: "nav.sports", label: "Sports", href: "/sports" },
  { labelKey: "nav.live", label: "Live", href: "/live" },
  { labelKey: "nav.promotions", label: "Promotions", href: "/promotions" },
  { labelKey: "nav.results", label: "Results", href: "/results" },
];

export default function Header({ user, siteName }: { user: HeaderUser; siteName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { push } = useToast();
  const { t } = useTranslation();
  const { open: openDrawer } = useDrawer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close overlays on route change
  useEffect(() => {
    const t = setTimeout(() => setMenuOpen(false), 0);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const link = "rounded-lg px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:text-ink";
  const activeLink = "rounded-lg px-3 py-2 text-sm font-semibold text-ink";

  async function logout() {
    const res = await apiFetch("/api/auth/logout", { method: "POST", body: {} });
    if (res.ok) {
      push("success", "Logged out. See you soon!");
      router.push("/");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[#0d1726]/95 backdrop-blur-md">
      {/* ── Top row ─────────────────────────────────────────── */}
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <button
          onClick={openDrawer}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-white/5 hover:text-ink1"
          aria-label="Open menu"
        >
          <IconMenu className="h-6 w-6" />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-[#052e16]">V</span>
          <span className="text-base font-extrabold tracking-tight sm:text-lg">{siteName}</span>
        </Link>

        {/* Desktop nav */}
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {DESKTOP_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={n.exact ? (pathname === n.href ? activeLink : link) : isActive(n.href) ? activeLink : link}
            >
              {t(n.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSelector />
          <div className="hidden md:block">
            <SearchBox />
          </div>

          {user ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Balance pill */}
              <div className="hidden items-center gap-1 rounded-full border border-line bg-[#131d2e] px-3 py-1.5 text-xs font-bold text-ink sm:flex">
                <span className="text-ink3">{user.currencyCode}</span>
                <span className="text-green-400">{user.balanceLabel.replace(/^\S+\s/, "")}</span>
              </div>

              {/* Wallet button → deposit modal */}
              <button
                onClick={() => setWalletOpen(true)}
                aria-label="Deposit"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-[#052e16] shadow-[0_4px_14px_rgba(0,230,118,0.35)] transition-transform hover:scale-105"
              >
                <IconWallet className="h-5 w-5" />
              </button>

              {/* Profile → account menu */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="Account menu"
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-[#131d2e] text-ink transition-colors hover:border-line2"
                >
                  <IconUser className="h-5 w-5" />
                  {user.unreadNotifications > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
                      {user.unreadNotifications}
                    </span>
                  )}
                </button>

                {menuOpen && (
                  <div className="fade-in absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl border border-line bg-[#10182c] shadow-2xl">
                    <div className="border-b border-line px-4 py-3">
                      <div className="text-xs text-ink3">Balance</div>
                      <div className="text-lg font-extrabold text-green-400">{user.balanceLabel}</div>
                    </div>
                    <div className="py-1">
                      {[
                        ["/account", t("nav.profile")],
                        ["/account/bets", t("nav.my_bets")],
                        ["/account/deposit", t("nav.deposit")],
                        ["/account/withdraw", t("nav.withdraw")],
                        ["/account/settings", t("nav.settings")],
                      ].map(([href, label]) => (
                        <Link
                          key={href}
                          href={href}
                          className="block px-4 py-2 text-sm text-ink2 hover:bg-white/5 hover:text-ink"
                          onClick={() => setMenuOpen(false)}
                        >
                          {label}
                        </Link>
                      ))}
                      {user.role !== "CUSTOMER" && (
                        <Link href="/admin" className="block px-4 py-2 text-sm font-semibold text-accent hover:bg-white/5">
                          Admin Panel
                        </Link>
                      )}
                      <button className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-white/5" onClick={logout}>
                        {t("nav.logout")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link href="/login" className="btn btn-ghost btn-sm !px-3">{t("nav.login")}</Link>
              <Link href="/register" className="btn btn-primary btn-sm !px-3">{t("nav.register")}</Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Category scrollbar ─────────────────────────────── */}
      <div className="border-t border-line bg-[#0d1726]/60">
        <div className="no-scrollbar mx-auto flex max-w-[1600px] items-stretch gap-1 overflow-x-auto px-2 sm:px-4">
          {CATEGORY_TABS.map(({ labelKey, label, href, Icon }) => {
            const active = pathname === href || (href !== "/live" && isActive(href)) || (href === "/live" && isActive("/live"));
            return (
              <Link
                key={label}
                href={href}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-bold transition-colors sm:text-sm ${
                  active ? "border-brand text-brand" : "border-transparent text-ink2 hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                {labelKey ? t(labelKey) : label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Full-width search (mobile) ─────────────────────── */}
      <div className="border-t border-line/60 px-3 py-2 md:hidden">
        <MobileSearch />
      </div>

      {/* ── Deposit modal (wallet button) ──────────────────── */}
      {walletOpen && <DepositModal onClose={() => setWalletOpen(false)} />}
    </header>
  );
}

// ── Mobile search (navigates to /search on submit) ───────────
function MobileSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length > 0) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
      <input
        className="input !rounded-full !py-2.5 !pl-9 text-sm"
        placeholder="Search teams, leagues..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search"
      />
    </form>
  );
}

// ── Desktop search (debounced, instant results) ──────────────
type SearchHit = {
  id: string;
  name: string;
  slug?: string;
  icon?: string | null;
  homeName?: string;
  awayName?: string;
  sport?: { icon?: string | null } | null;
};

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ games: SearchHit[]; sports: SearchHit[] } | null>(null);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      const t = setTimeout(() => setResults(null), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      const res = await apiFetch<{ games: SearchHit[]; sports: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(res.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input w-40 py-2 transition-all focus:w-56 lg:w-52"
        placeholder="Search teams, leagues..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/search?q=${encodeURIComponent(q)}`);
        }}
      />
      {focused && q.trim().length >= 2 && results && (
        <div className="fade-in absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-[#10182c] shadow-2xl">
          {results.games.length === 0 && results.sports.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink3">No results for “{q}”</div>
          )}
          {results.sports.length > 0 && (
            <div className="border-b border-line px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Sports</div>
              {results.sports.map((s: SearchHit) => (
                <Link key={s.id} href={`/sports/${s.slug}`} className="block py-1.5 text-sm text-ink2 hover:text-ink">
                  {s.icon} {s.name}
                </Link>
              ))}
            </div>
          )}
          {results.games.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Matches</div>
              {results.games.map((g: SearchHit) => (
                <Link key={g.id} href={`/match/${g.id}`} className="block py-1.5 text-sm text-ink2 hover:text-ink">
                  {g.sport?.icon ?? ""} {g.homeName} vs {g.awayName}
                </Link>
              ))}
              <Link href={`/search?q=${encodeURIComponent(q)}`} className="block py-1.5 text-xs font-semibold text-brand">
                View all results →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
