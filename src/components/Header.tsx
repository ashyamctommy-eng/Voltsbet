"use client";

import Link from "next/link";
import { SportIcon } from "@/components/SportIcon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { useDrawer } from "@/components/DrawerProvider";
import DepositModal from "@/components/DepositModal";
import UNIBET360Logo from "@/components/VoltBetLogo";
import { FEED_VIEWS, type FeedView } from "@/components/MatchFeed";
import { useTranslation } from "react-i18next";
import {
  IconMenu,
  IconSearch,
  IconLive,
  IconWallet,
  IconUser,
  IconBell,
} from "@/components/icons";
import { formatDateTime } from "@/lib/odds";

/** Numeric value of a compact money label like "KSh 1.2k" / "$400.00". */
function labelAmount(label: string): number {
  return parseFloat(label.replace(/^\S+\s/, "").replace(/[^0-9.]/g, "")) || 0;
}

export type HeaderUser = {
  username: string;
  role: string;
  currencyCode: string;
  balanceLabel: string;
  /** Bonus pool label (Wallet.bonusBalance) — "$0.00" when none. */
  bonusLabel: string;
  /** First successful deposit completed → bonus balance unlocked for betting. */
  hasDeposited: boolean;
  unreadNotifications: number;
} | null;

type HeaderSport = { slug: string; name: string; icon: string | null };

const DESKTOP_NAV = [
  { labelKey: "nav.home", label: "Home", href: "/", exact: true },
  { labelKey: "nav.sports", label: "Sports", href: "/sports" },
  { labelKey: "nav.live", label: "Live", href: "/live" },
  { labelKey: "nav.promotions", label: "Promotions", href: "/promotions" },
  { labelKey: "nav.results", label: "Results", href: "/results" },
];

export default function Header({
  user,
  siteName,
  sports,
}: {
  user: HeaderUser;
  siteName: string;
  /** Active sports from the DB (provider-driven category tabs). */
  sports?: HeaderSport[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { push } = useToast();
  const { t } = useTranslation();
  const { open: openDrawer } = useDrawer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  // Live notification feed (real unread count, marks read on open).
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ id: string; title: string; message: string; read: boolean; createdAt: string }[] | null>(null);
  const [unread, setUnread] = useState(user?.unreadNotifications ?? 0);
  const notifRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Category tabs — sports from the provider/DB, Live pinned last.
  const categoryTabs: { labelKey?: string; label: string; href: string; icon?: string | null }[] = [
    ...(sports ?? []).map((sp) => ({ label: sp.name, href: `/sports/${sp.slug}`, icon: sp.icon })),
    { labelKey: "nav.live", label: "Live", href: "/live" },
  ];

  // Sub-navigation pills (Highlights/Upcoming/Countries) — the landing
  // feed view. Active pill follows ?view= (default: Highlights).
  const activeView: FeedView =
    (searchParams?.get("view") as FeedView) ?? "highlights";
  // Pills switch the feed view IN PLACE: on a sport tab they keep the sport
  // route (e.g. /sports/football?view=upcoming) instead of jumping home —
  // the filter bar stays visible and active on every feed surface.
  const feedPath = pathname.startsWith("/sports/") ? pathname : "/";
  // Browse chrome (sports category tabs, feed-view pills, search bars) belongs
  // on the betting surfaces (home /sports/* /live /search …) — NOT on account
  // or admin pages, where it crowds the header and pushes content down.
  const showBrowseChrome =
    !pathname.startsWith("/account") && !pathname.startsWith("/admin");

  // Close overlays on route change
  useEffect(() => {
    const t = setTimeout(() => setMenuOpen(false), 0);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /** Open the notification feed: fetch latest, then mark everything read. */
  async function toggleNotifs() {
    if (notifOpen) {
      setNotifOpen(false);
      return;
    }
    setMenuOpen(false);
    const res = await apiFetch<{ notifications: { id: string; title: string; message: string; read: boolean; createdAt: string }[] }>("/api/notifications");
    if (!res.ok) return;
    setNotifs(res.data.notifications);
    setNotifOpen(true);
    const anyUnread = res.data.notifications.some((n) => !n.read);
    if (anyUnread) {
      // Mark-all-read (POST without id) then reflect it locally — the badge
      // and list stay in sync without a hard refresh.
      const mark = await apiFetch("/api/notifications", { method: "POST", body: {} });
      if (mark.ok) {
        setUnread(0);
        setNotifs((cur) => cur?.map((n) => ({ ...n, read: true })) ?? cur);
      }
    }
  }

  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const link = "rounded-lg px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:text-ink";
  const activeLink = "rounded-lg px-3 py-2 text-sm font-semibold text-ink";

  async function logout() {
    const res = await apiFetch("/api/auth/logout", { method: "POST", body: {} });
    if (res.ok) {
      push("success", t("common.loggedOut"));
      router.push("/");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-panel-bg/95 backdrop-blur-md">
      {/* ── Top row ─────────────────────────────────────────── */}
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <button
          onClick={openDrawer}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-hover-tint hover:text-ink1"
          aria-label={t("common.openMenu")}
        >
          <IconMenu className="h-6 w-6" />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2">
          <UNIBET360Logo />
          <span className="sr-only">{siteName}</span>
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
          {showBrowseChrome && (
            <div className="hidden md:block">
              <SearchBox />
            </div>
          )}

          {user ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Dual balance block → tap to deposit (replaces the wallet icon pill) */}
              <button
                onClick={() => setWalletOpen(true)}
                aria-label={t("nav.deposit")}
                title={
                  labelAmount(user.bonusLabel) > 0 && !user.hasDeposited
                    ? "Bonus unlocks after your first deposit"
                    : undefined
                }
                className="group hidden flex-col items-end rounded-2xl border border-line bg-card px-3 py-1 text-right transition-colors hover:border-line2 sm:flex"
              >
                <span className="flex items-center gap-1 text-[10px] font-semibold leading-none text-ink3">
                  {t("common.balance", { defaultValue: "Balance" })}
                  <span className="font-bold text-green-400">
                    {user.currencyCode} {user.balanceLabel.replace(/^\S+\s/, "")}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold leading-none text-ink3">
                  {t("common.bonus", { defaultValue: "Bonus" })}
                  <span className={`font-bold ${labelAmount(user.bonusLabel) > 0 ? "text-amber-400" : "text-ink3"}`}>
                    {user.currencyCode} {user.bonusLabel.replace(/^\S+\s/, "")}
                  </span>
                  {labelAmount(user.bonusLabel) > 0 && !user.hasDeposited && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Locked until first deposit" />
                  )}
                </span>
              </button>

              {/* Mobile: compact wallet button → deposit modal (dual block is ≥sm) */}
              <button
                onClick={() => setWalletOpen(true)}
                aria-label={t("nav.deposit")}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-brand transition-colors hover:border-line2 sm:hidden"
              >
                <IconWallet className="h-5 w-5" />
              </button>

              {/* Notifications bell — live unread badge + dropdown */}
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => { void toggleNotifs(); }}
                  aria-label={t("common.notifications")}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink transition-colors hover:border-line2"
                >
                  <IconBell className="h-5 w-5" />
                  {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="fade-in absolute right-0 top-full z-50 mt-2 w-[19rem] overflow-hidden rounded-xl border border-line bg-[var(--panel-bg,#121824)] shadow-2xl">
                    <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                      <span className="text-sm font-bold">{t("common.notifications")}</span>
                      <button
                        className="text-[11px] font-semibold text-ink3 transition-colors hover:text-brand"
                        onClick={() => { void toggleNotifs(); }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {!notifs || notifs.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-ink3">
                          {t("common.noNotifications")}
                        </div>
                      ) : (
                        notifs.slice(0, 15).map((n) => (
                          <div key={n.id} className="border-b border-line/60 px-4 py-2.5 last:border-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold text-ink">{n.title}</span>
                              <span className="shrink-0 text-[10px] tabular-nums text-ink3">{formatDateTime(new Date(n.createdAt), { date: false })}</span>
                            </div>
                            {n.message && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink2">{n.message}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile → account menu */}
              <div className="relative overflow-visible" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label={t("common.accountMenu")}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink transition-colors hover:border-line2"
                >
                  <IconUser className="h-5 w-5" />
                  {user.unreadNotifications > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
                      {user.unreadNotifications}
                    </span>
                  )}
                </button>

                {menuOpen && (
                  <div className="fade-in absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-[var(--panel-bg,#121824)] shadow-2xl">
                    <div className="border-b border-line px-4 py-3">
                      <div className="text-xs text-ink3">{t("common.balance")}</div>
                      <div className="text-lg font-extrabold text-green-400">{user.balanceLabel}</div>
                      {labelAmount(user.bonusLabel) > 0 && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink3">
                          <span>{t("common.bonus", { defaultValue: "Bonus" })}</span>
                          <span className="font-bold text-amber-400">{user.bonusLabel}</span>
                          {!user.hasDeposited && (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-400">
                              Locked
                            </span>
                          )}
                        </div>
                      )}
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
                          className="block px-4 py-2 text-sm text-ink2 hover:bg-hover-tint hover:text-ink"
                          onClick={() => setMenuOpen(false)}
                        >
                          {label}
                        </Link>
                      ))}
                      {user.role !== "CUSTOMER" && (
                        <Link href="/admin" className="block px-4 py-2 text-sm font-semibold text-accent hover:bg-hover-tint">
                          {t("nav.adminPanel")}
                        </Link>
                      )}
                      <button className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-hover-tint" onClick={logout}>
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

      {showBrowseChrome && (
      <>
      {/* ── Category scrollbar (provider-driven sports) ────────── */}
      <div className="border-t border-line bg-panel-bg/60">
        <div className="no-scrollbar mx-auto flex max-w-[1600px] items-stretch gap-1 overflow-x-auto px-2 sm:px-4">
          {categoryTabs.map(({ labelKey, label, href, icon }) => {
            const active =
              pathname === href ||
              (href !== "/live" && isActive(href)) ||
              (href === "/live" && isActive("/live")) ||
              // The landing page IS the Football tab — active by default.
              (href === "/sports/football" && pathname === "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-bold transition-colors sm:text-sm ${
                  active ? "border-brand text-brand" : "border-transparent text-ink2 hover:text-ink"
                }`}
              >
                {icon ? <span aria-hidden>{icon}</span> : labelKey === "nav.live" ? <IconLive className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /> : null}
                {labelKey ? t(labelKey) : label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Sub-navigation pills: Highlights | Upcoming | Countries ── */}
      <div className="border-t border-line/70 bg-panel-bg/40">
        <div className="no-scrollbar mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-2 py-1.5 sm:px-4">
          {FEED_VIEWS.map((v) => {
            const active = activeView === v.id;
            return (
              <Link
                key={v.id}
                href={`${feedPath}?view=${v.id}`}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-colors sm:text-xs ${
                  active ? "bg-brand text-[#052e16]" : "bg-card text-ink2 hover:text-ink"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {t(v.labelKey)}
              </Link>
            );
          })}
          <span className="ml-auto hidden shrink-0 text-[11px] font-semibold text-ink3 md:block">
            {t("common.preMatchOdds", { sport: sports?.find((s) => s.slug === "football")?.name ?? "Football" })}
          </span>
        </div>
      </div>

      {/* ── Full-width search (mobile) — hidden on account/admin ── */}
      {showBrowseChrome && (
        <div className="max-w-full overflow-x-hidden border-t border-line/60 px-3 py-2 md:hidden">
          <MobileSearch />
        </div>
      )}
      </>
      )}

      {/* ── Deposit modal (wallet button) ──────────────────── */}
      {walletOpen && <DepositModal onClose={() => setWalletOpen(false)} />}
    </header>
  );
}

// ── Mobile search (navigates to /search on submit) ───────────
function MobileSearch() {
  const router = useRouter();
  const { t } = useTranslation();
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
        placeholder={t("common.search_placeholder")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t("nav.search")}
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
  sport?: { slug?: string; icon?: string | null } | null;
};

function SearchBox() {
  const router = useRouter();
  const { t } = useTranslation();
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
    <div className="relative z-10" ref={boxRef}>
      <input
        className="input w-40 py-2 transition-all focus:w-56 lg:w-52"
        placeholder={t("common.search_placeholder")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/search?q=${encodeURIComponent(q)}`);
        }}
      />
      {focused && q.trim().length >= 2 && results && (
        <div className="fade-in absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
          {results.games.length === 0 && results.sports.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink3">{t("common.noResults", { q })}</div>
          )}
          {results.sports.length > 0 && (
            <div className="border-b border-line px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{t("nav.sports")}</div>
              {results.sports.map((s: SearchHit) => (
                <Link key={s.id} href={`/sports/${s.slug}`} className="block py-1.5 text-sm text-ink2 hover:text-ink">
                  <SportIcon slug={s.slug} icon={s.icon} className="h-3.5 w-3.5 shrink-0" /> {s.name}
                </Link>
              ))}
            </div>
          )}
          {results.games.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{t("common.matches")}</div>
              {results.games.map((g: SearchHit) => (
                <Link key={g.id} href={`/match/${g.id}`} className="block py-1.5 text-sm text-ink2 hover:text-ink">
                  <SportIcon slug={g.sport?.slug} icon={g.sport?.icon} className="h-3.5 w-3.5 shrink-0" /> {g.homeName} vs {g.awayName}
                </Link>
              ))}
              <Link href={`/search?q=${encodeURIComponent(q)}`} className="block py-1.5 text-xs font-semibold text-brand">
                {t("common.viewAll")} →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
