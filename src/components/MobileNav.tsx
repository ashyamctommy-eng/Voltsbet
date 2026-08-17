"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBetSlip } from "@/components/BetSlipContext";
import { IconHome, IconArrowDown, IconFootball, IconTv } from "@/components/icons";

export default function MobileNav({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const { items, setOpen } = useBetSlip();
  const count = items.length;

  const tabs = [
    { href: "/", label: "Home", Icon: IconHome, active: pathname === "/" },
    { href: "/account/deposit", label: "Deposit", Icon: IconArrowDown, active: pathname.startsWith("/account/deposit") },
    null, // center betslip slot
    { href: "/sports", label: "Sports", Icon: IconFootball, active: pathname === "/sports" || pathname.startsWith("/sports/") },
    { href: "/live", label: "Live", Icon: IconTv, active: pathname.startsWith("/live"), live: true },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-[#0d1726]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md xl:hidden">
      {tabs.map((t, i) =>
        t === null ? (
          <div key="betslip-slot" className="relative flex flex-1 items-center justify-center">
            {/* Floating central betslip button */}
            <button
              onClick={() => setOpen(true)}
              aria-label={`Bet slip, ${count} selection${count === 1 ? "" : "s"}`}
              className="absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#0d1726] bg-gradient-to-br from-amber-300 to-orange-500 text-lg font-black text-[#3a1f00] shadow-[0_6px_20px_rgba(245,158,11,0.45)] transition-transform active:scale-95"
            >
              {count}
            </button>
          </div>
        ) : (
          <Link
            key={t.label}
            href={t.href}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${
              t.active ? "text-brand" : "text-ink2"
            }`}
          >
            <span className="relative">
              <t.Icon className="h-5 w-5" />
              {t.live && (
                <span className="absolute -right-1.5 -top-1 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              )}
            </span>
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
