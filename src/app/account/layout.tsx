import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

const TABS = [
  { href: "/account", label: "Dashboard" },
  { href: "/account/bets", label: "My Bets" },
  { href: "/account/deposit", label: "Deposit" },
  { href: "/account/withdraw", label: "Withdraw" },
  { href: "/account/transactions", label: "Transactions" },
  { href: "/account/settings", label: "Settings" },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">My Account</h1>
        <span className="text-sm text-ink3">Signed in as <span className="font-semibold text-ink2">{user.username}</span></span>
      </div>

      <div className="mt-5 flex gap-6">
        <aside className="hidden w-48 shrink-0 md:block">
          <nav className="sticky top-20 space-y-1">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:bg-hover-tint hover:text-ink"
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 pb-8">
          <div className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1 md:hidden">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink2">
                {t.label}
              </Link>
            ))}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
