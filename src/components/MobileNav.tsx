"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBetSlip } from "@/components/BetSlipContext";

export default function MobileNav({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const { items, setOpen } = useBetSlip();

  const tabs = [
    { href: "/", label: "Home", icon: "🏠" },
    { href: "/sports", label: "Sports", icon: "⚽" },
    { href: "/live", label: "Live", icon: "🔴" },
    ...(loggedIn
      ? [{ href: "/account", label: "Account", icon: "👤" }]
      : [{ href: "/login", label: "Login", icon: "👤" }]),
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-[#0b1220]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] xl:hidden">
      {tabs.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.label}
            href={t.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${
              active ? "text-brand" : "text-ink2"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
      <button
        className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-ink2"
        onClick={() => setOpen(true)}
      >
        <span className="text-lg leading-none">🎯</span>
        Bets
        {items.length > 0 && (
          <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-[#052e16]">
            {items.length}
          </span>
        )}
      </button>
    </nav>
  );
}
