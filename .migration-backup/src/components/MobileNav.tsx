"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBetSlip } from "@/components/BetSlipContext";
import BetslipBar from "@/components/BetslipBar";
import { useTranslation } from "react-i18next";
import { IconHome, IconSearch, IconFlame, IconTv } from "@/components/icons";

export default function MobileNav({ liveCount = 0 }: { loggedIn: boolean; liveCount?: number }) {
  const pathname = usePathname();
  const { items, setOpen } = useBetSlip();
  const { t } = useTranslation();
  const count = items.length;

  const tabs = [
    { href: "/", label: t("nav.home"), Icon: IconHome, active: pathname === "/" },
    { href: "/search", label: t("nav.search"), Icon: IconSearch, active: pathname.startsWith("/search") },
    null, // center betslip slot
    { href: "/account", label: t("nav.refer"), Icon: IconFlame, active: pathname.startsWith("/account"), flame: true },
    { href: "/live", label: t("nav.live"), Icon: IconTv, active: pathname.startsWith("/live"), badge: liveCount },
  ];

  return (
    <>
      {/* Sticky betslip bar (shows when picks exist) */}
      <BetslipBar />

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-panel-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md xl:hidden">
        {tabs.map((t) =>
          t === null ? (
            <div key="betslip-slot" className="relative flex flex-1 items-center justify-center">
              {/* Central floating betslip counter */}
              <button
                onClick={() => setOpen(true)}
                aria-label={`Bet slip, ${count} selection${count === 1 ? "" : "s"}`}
                className={`absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-panel-bg text-lg font-black shadow-[0_6px_20px_rgba(245,158,11,0.45)] transition-transform active:scale-95 ${
                  count > 0
                    ? "bg-gradient-to-br from-amber-300 to-orange-500 text-[#3a1f00]"
                    : "bg-gradient-to-br from-amber-200 to-orange-300 text-[#7a4a00]"
                }`}
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
                <t.Icon className={`h-5 w-5 ${t.flame ? "flame-icon text-orange-400" : ""}`} />
                {!!t.badge && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {t.badge}
                  </span>
                )}
              </span>
              {t.label}
            </Link>
          ),
        )}
      </nav>
    </>
  );
}
