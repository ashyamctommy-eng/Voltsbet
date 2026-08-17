"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBetSlip } from "@/components/BetSlipContext";
import { IconHome, IconSports, IconLive, IconUser, IconTicket } from "@/components/icons";

export default function MobileNav({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const { items, setOpen } = useBetSlip();

  const tabs = [
    { href: "/", label: "Home", Icon: IconHome },
    { href: "/sports", label: "Sports", Icon: IconSports },
    { href: "/live", label: "Live", Icon: IconLive },
    loggedIn
      ? { href: "/account", label: "Account", Icon: IconUser }
      : { href: "/login", label: "Login", Icon: IconUser },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-[#0b1220]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] xl:hidden">
      {tabs.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.label}
            href={t.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${
              active ? "text-brand" : "text-ink2 hover:text-ink1"
            }`}
          >
            <t.Icon className="h-5 w-5" />
            {t.label}
          </Link>
        );
      })}
      <button
        className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold text-ink2 transition-colors hover:text-ink1"
        onClick={() => setOpen(true)}
      >
        <IconTicket className="h-5 w-5" />
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
