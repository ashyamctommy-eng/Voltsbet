import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { can, Resource } from "@/lib/api";
import {
  IconDashboard,
  IconFootball,
  IconCalendar,
  IconUsers,
  IconDownload,
  IconUpload,
  IconCoins,
  IconGlobe,
  IconGift2,
  IconImage,
  IconBell,
  IconGear,
  IconScroll,
  IconPlug,
  IconController,
} from "@/components/icons";
import AdminBroadcastButton from "@/components/admin/BroadcastDrawer";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || user.role === "CUSTOMER") redirect("/login");

  const NAV: { resource: Resource; href: string; label: string; Icon: (p: { className?: string }) => React.ReactNode }[] = [
    { resource: "dashboard", href: "/admin", label: "Dashboard", Icon: IconDashboard },
    { resource: "sports", href: "/admin/sports", label: "Sports", Icon: IconFootball },
    { resource: "games", href: "/admin/games", label: "Games", Icon: IconCalendar },
    { resource: "users", href: "/admin/users", label: "Users", Icon: IconUsers },
    { resource: "deposits", href: "/admin/deposits", label: "Deposits", Icon: IconDownload },
    { resource: "withdrawals", href: "/admin/withdrawals", label: "Withdrawals", Icon: IconUpload },
    { resource: "currencies", href: "/admin/currencies", label: "Currencies", Icon: IconCoins },
    { resource: "languages", href: "/admin/languages", label: "Languages", Icon: IconGlobe },
    { resource: "promotions", href: "/admin/promotions", label: "Promotions", Icon: IconGift2 },
    { resource: "banners", href: "/admin/banners", label: "Banners", Icon: IconImage },
    { resource: "notifications", href: "/admin/notifications", label: "Announcements", Icon: IconBell },
    { resource: "crypto", href: "/admin/settings#payments", label: "Payments", Icon: IconCoins },
    { resource: "settings", href: "/admin/api-settings", label: "API Settings", Icon: IconPlug },
    { resource: "settings", href: "/admin/settings", label: "Website Settings", Icon: IconGear },
    { resource: "settings", href: "/admin/settings/currency", label: "Default Currency", Icon: IconCoins },
    { resource: "dashboard", href: "/admin/ops", label: "Daily OPS", Icon: IconController },
    { resource: "audit", href: "/admin/audit", label: "Audit Logs", Icon: IconScroll },
  ];
  const visible = NAV.filter((n) => can(user.role, n.resource));

  return (
    <div className="mx-auto max-w-[1700px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">Admin Panel</h1>
        <div className="flex items-center gap-3 text-sm text-ink2">
          <AdminBroadcastButton />
          <span className="rounded-full bg-accent/15 px-3 py-1 font-semibold text-accent">{user.role.replace("_", " ")}</span>
          <Link href="/" className="text-ink3 hover:text-ink">← View site</Link>
        </div>
      </div>

      <div className="mt-5 flex gap-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-0.5">
            {visible.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:bg-hover-tint hover:text-ink"
              >
                <span className="inline-flex items-center gap-2">
                  <n.Icon className="h-4 w-4 text-ink3" />
                  {n.label}
                </span>
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 pb-10">
          <div className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1 lg:hidden">
            {visible.map((n) => (
              <Link key={n.href} href={n.href} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink2">
                {n.label}
              </Link>
            ))}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
