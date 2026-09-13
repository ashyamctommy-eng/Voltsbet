import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AccountSidebar, AccountTabs } from "@/components/account/AccountNav";
import SignOutButton from "@/components/account/SignOutButton";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const verified = user.verified;
  const active = user.status === "ACTIVE";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      {/* Identity block. Verification is the thing that blocks a withdrawal, so
          it belongs in the header rather than buried as a dashboard stat. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-full border border-brand/40 bg-brand/15 font-black text-brand-text"
          >
            {user.username.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">{user.username}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  active ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
                }`}
              >
                {active ? "● Active" : user.status.replace("_", " ")}
              </span>
              {!verified && (
                <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">
                  Verify to withdraw
                </span>
              )}
            </div>
          </div>
        </div>
        <SignOutButton />
      </div>

      <div className="mt-5 flex gap-6">
        <AccountSidebar />
        <div className="min-w-0 flex-1 pb-8">
          <AccountTabs />
          {children}
        </div>
      </div>
    </div>
  );
}
