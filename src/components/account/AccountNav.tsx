"use client";

/**
 * Account section navigation.
 *
 * The shell previously rendered every tab identically — no active state on
 * either the desktop sidebar or the mobile pill row — so on Settings, "Settings"
 * looked exactly like "Dashboard". Orientation is the entire job of a section
 * shell, and it needs `usePathname`, which is why this lives in a client
 * component while the layout stays a server component (auth + data).
 *
 * The mobile row also gets an edge fade: six tabs on a 360px screen put
 * Transactions and Settings off-screen, and `no-scrollbar` gave no hint that
 * the row scrolls at all.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account", label: "Dashboard" },
  { href: "/account/bets", label: "My Bets" },
  { href: "/account/deposit", label: "Deposit" },
  { href: "/account/withdraw", label: "Withdraw" },
  { href: "/account/transactions", label: "Transactions" },
  { href: "/account/settings", label: "Profile" },
];

function useIsActive() {
  const pathname = usePathname();
  // "/account" must match exactly, or every child route would light it up too.
  return (href: string) => (href === "/account" ? pathname === "/account" : pathname.startsWith(href));
}

/** Desktop sidebar. */
export function AccountSidebar() {
  const isActive = useIsActive();
  return (
    <aside className="hidden w-48 shrink-0 md:block">
      <nav className="sticky top-20 space-y-1">
        {TABS.map((t) => {
          const on = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                on
                  ? "bg-brand/15 font-bold text-ink"
                  : "font-medium text-ink2 hover:bg-hover-tint hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/** Mobile pill row, with a fade so the off-screen tabs are discoverable. */
export function AccountTabs() {
  const isActive = useIsActive();
  return (
    <div className="relative mb-4 md:hidden">
      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => {
          const on = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                on
                  ? "border-brand/50 bg-brand/15 font-bold text-ink"
                  : "border-line font-semibold text-ink2"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-panel-bg to-transparent"
      />
    </div>
  );
}
