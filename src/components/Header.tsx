"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

export type HeaderUser = {
  username: string;
  role: string;
  balanceLabel: string;
  unreadNotifications: number;
} | null;

const SPORT_LINKS = [
  { label: "Football", slug: "football" },
  { label: "Basketball", slug: "basketball" },
  { label: "Tennis", slug: "tennis" },
  { label: "Other Sports", slug: "other" },
];

export default function Header({ user, siteName }: { user: HeaderUser; siteName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { push } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sportsOpen, setSportsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setSportsOpen(false);
      }
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
    <header className="sticky top-0 z-40 border-b border-line bg-[#0b1220]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-[#052e16]">
            V
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            {siteName}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          <Link href="/" className={isActive("/") && pathname === "/" ? activeLink : link}>Home</Link>
          <Link href="/sports" className={isActive("/sports") ? activeLink : link}>Sports</Link>
          <Link href="/live" className={isActive("/live") ? activeLink : link}>
            <span className="flex items-center gap-1.5">
              <span className="live-dot" /> Live
            </span>
          </Link>
          {SPORT_LINKS.map((s) => (
            <Link key={s.slug} href={`/sports/${s.slug}`} className={link}>
              {s.label}
            </Link>
          ))}
          <Link href="/promotions" className={isActive("/promotions") ? activeLink : link}>Promotions</Link>
          <Link href="/results" className={isActive("/results") ? activeLink : link}>Results</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SearchBox />

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-line2"
                onClick={() => { setMenuOpen((v) => !v); setSportsOpen(false); }}
              >
                <span className="hidden h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white sm:flex">
                  {user.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[90px] truncate">{user.username}</span>
                {user.unreadNotifications > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
                    {user.unreadNotifications}
                  </span>
                )}
                <span className="text-[10px] text-ink3">▾</span>
              </button>

              {menuOpen && (
                <div className="fade-in absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl border border-line bg-[#10182c] shadow-2xl">
                  <div className="border-b border-line px-4 py-3">
                    <div className="text-xs text-ink3">Balance</div>
                    <div className="text-lg font-extrabold text-green-400">{user.balanceLabel}</div>
                  </div>
                  <div className="py-1">
                    {[
                      ["/account", "My Account"],
                      ["/account/bets", "My Bets"],
                      ["/account/deposit", "Deposit"],
                      ["/account/withdraw", "Withdraw"],
                      ["/account/settings", "Settings"],
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
                    <button
                      className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-white/5"
                      onClick={logout}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/login" className="btn btn-ghost btn-sm">Log In</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Register</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── Search box (debounced, instant results) ──────────────────
function SearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ games: any[]; sports: any[] } | null>(null);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      const res = await apiFetch<{ games: any[]; sports: any[] }>(`/api/search?q=${encodeURIComponent(q)}`);
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
    <div className="relative hidden md:block" ref={boxRef}>
      <input
        className="input w-44 py-2 transition-all focus:w-64 lg:w-56"
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => { if (e.key === "Enter") window.location.href = `/search?q=${encodeURIComponent(q)}`; }}
      />
      {focused && q.trim().length >= 2 && results && (
        <div className="fade-in absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-[#10182c] shadow-2xl">
          {results.games.length === 0 && results.sports.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink3">No results for “{q}”</div>
          )}
          {results.sports.length > 0 && (
            <div className="border-b border-line px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Sports</div>
              {results.sports.map((s: any) => (
                <Link key={s.id} href={`/sports/${s.slug}`} className="block py-1.5 text-sm text-ink2 hover:text-ink">
                  {s.icon} {s.name}
                </Link>
              ))}
            </div>
          )}
          {results.games.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Matches</div>
              {results.games.map((g: any) => (
                <Link key={g.id} href={`/match/${g.id}`} className="block py-1.5 text-sm text-ink2 hover:text-ink">
                  {g.sport.icon} {g.homeName} vs {g.awayName}
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
