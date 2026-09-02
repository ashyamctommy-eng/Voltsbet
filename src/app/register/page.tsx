"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { LANGUAGES } from "@/lib/i18n-resources";
import { useToast } from "@/components/BetSlipContext";

export default function RegisterPage() {
  const router = useRouter();
  const { push } = useToast();
  const [form, setForm] = useState({
    fullName: "", username: "", email: "", phone: "", password: "", confirmPassword: "",
    country: "KE", language: "en", currency: "KES", referralCode: "", terms: false,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Wallet currencies are strictly USD | KES (data-driven list filtered). */
  const [currencies, setCurrencies] = useState<{ code: string; name: string; symbol: string }[] | null>(null);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Load the DB currency list (filtered to the USD|KES wallet set); pre-select
  // the platform default when it is one of the two.
  useEffect(() => {
    const t = setTimeout(() => {
      void apiFetch<{ currencies: { code: string; name: string; symbol: string }[]; defaultCode: string }>("/api/public/currencies")
        .then((r) => {
          if (!r.ok || !r.data.currencies.length) return;
          const wallets = r.data.currencies.filter((c) => c.code === "USD" || c.code === "KES");
          if (!wallets.length) return;
          setCurrencies(wallets);
          if (r.data.defaultCode === "USD" || r.data.defaultCode === "KES") set("currency", r.data.defaultCode);
        });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Prefill referral code from ?ref=VOLT-XXXX (share links from the account page).
  useEffect(() => {
    const t = setTimeout(() => {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) set("referralCode", ref);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await apiFetch("/api/auth/register", { method: "POST", body: form });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    push("success", "Account created. Welcome to UNIBET360! 🎉");
    // Smart auth redirect: ?redirect=/account/deposit (set when an
    // insufficient-balance guest was routed here from the betslip) sends the
    // new user straight to funding their wallet — selections survive via the
    // betslip localStorage cache.
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    router.push(redirect && redirect.startsWith("/") ? redirect : "/");
    router.refresh();
  }

  const input = "input";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold">Create your account</h1>
        <p className="mt-1 text-sm text-ink2">Join UNIBET360 and get a 100% welcome bonus on your first deposit.</p>

        <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 sm:col-span-2">{error}</div>
          )}

          <div className="sm:col-span-2">
            <label className="label" htmlFor="fullName">Full name</label>
            <input id="fullName" className={input} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required />
          </div>

          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" className={input} value={form.username} onChange={(e) => set("username", e.target.value)} required minLength={3} maxLength={20} />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input id="phone" className={input} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+254…" required />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className={input} value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </div>

          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" className={input} value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">Confirm password</label>
            <input id="confirmPassword" type="password" className={input} value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} required />
          </div>

          <div>
            <label className="label" htmlFor="country">Country</label>
            <select id="country" className={input} value={form.country} onChange={(e) => set("country", e.target.value)}>
              <option value="KE">Kenya</option>
              <option value="UG">Uganda</option>
              <option value="TZ">Tanzania</option>
              <option value="NG">Nigeria</option>
              <option value="GH">Ghana</option>
              <option value="ZA">South Africa</option>
              <option value="GB">United Kingdom</option>
              <option value="US">United States</option>
              <option value="DE">Germany</option>
              <option value="FR">France</option>
              <option value="NL">Netherlands</option>
              <option value="ES">Spain</option>
              <option value="PT">Portugal</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="currency">Preferred Wallet Currency</label>
            <select id="currency" className={input} value={form.currency} onChange={(e) => set("currency", e.target.value)} required>
              {(currencies ?? [
                { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
                { code: "USD", name: "US Dollar", symbol: "$" },
              ]).map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink3">Your wallet is created in this currency — balances, deposits and payouts display in it.</p>
          </div>

          <div>
            <label className="label" htmlFor="language">Preferred language</label>
            <select id="language" className={input} value={form.language} onChange={(e) => set("language", e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="referral">Referral code (optional)</label>
            <input id="referral" className={input} value={form.referralCode} onChange={(e) => set("referralCode", e.target.value)} placeholder="e.g. VOLT-DEMO" />
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink2 sm:col-span-2">
            <input type="checkbox" checked={form.terms} onChange={(e) => set("terms", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--vb-primary)]" required />
            <span>
              I am 18+ and accept the <Link href="/terms" className="text-brand hover:underline">Terms & Conditions</Link> and responsible gambling policy.
            </span>
          </label>

          <button className="btn btn-primary w-full py-3 sm:col-span-2" disabled={loading || !form.terms}>
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink2">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
