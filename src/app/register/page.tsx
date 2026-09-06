"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { apiErrorText } from "@/lib/api-error-text";
import { LANGUAGES, LANG_KEY } from "@/lib/i18n-resources";
import { useToast } from "@/components/BetSlipContext";
import RecaptchaGate from "@/components/auth/RecaptchaGate";
import CountryAutocomplete from "@/components/ui/CountryAutocomplete";

export default function RegisterPage() {
  const router = useRouter();
  const { push } = useToast();
  const { t } = useTranslation();
  /** Language select starts from the geo-detected site language (stored in
   *  localStorage by the site-wide i18n resolver) so registration continues
   *  in the visitor's language — falls back to English. */
  function initialLanguage(): string {
    try {
      const v = window.localStorage.getItem(LANG_KEY);
      return v && LANGUAGES.some((l) => l.code === v) ? v : "en";
    } catch {
      return "en";
    }
  }
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", password: "", confirmPassword: "",
    country: "", language: initialLanguage(), currency: "KES", referralCode: "", terms: false,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // reCAPTCHA v2 — widget + single-use token. Enforced only when the site key
  // is configured (NEXT_PUBLIC_RECAPTCHA_SITE_KEY inlined at build time).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaRequired = !!process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
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
    if (captchaRequired && !captchaToken) {
      setError(t("register.captchaRequired"));
      return;
    }
    setLoading(true);
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      body: { ...form, gRecaptchaToken: captchaToken ?? "" },
    });
    setLoading(false);
    if (!res.ok) {
      setError(apiErrorText(t, res.error.code, res.error.message));
      // The solved token is single-use — force a fresh widget + token.
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
      return;
    }
    push("success", t("register.welcome"));
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
        <div className="mx-auto w-full text-center">
          <h1 className="text-2xl font-extrabold">{t("register.title")}</h1>
          <p className="mx-auto mt-1 w-full max-w-md text-center text-sm text-ink2">{t("register.subtitle")}</p>
        </div>

        <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 sm:col-span-2">{error}</div>
          )}

          <div className="sm:col-span-2">
            <label className="label" htmlFor="fullName">{t("register.fullName")}</label>
            <input id="fullName" className={input} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder={t("register.fullNamePh")} required />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="phone">{t("register.phone")}</label>
            <input id="phone" className={input} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder={t("register.phonePh")} inputMode="tel" required />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="email">{t("register.email")}</label>
            <input id="email" type="email" className={input} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder={t("register.emailPh")} required />
          </div>

          <div>
            <label className="label" htmlFor="password">{t("register.password")}</label>
            <input id="password" type="password" className={input} value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={t("register.passwordPh")} required minLength={8} />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">{t("register.confirmPassword")}</label>
            <input id="confirmPassword" type="password" className={input} value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} required />
          </div>

          <div>
            <label className="label" htmlFor="country">{t("register.country")}</label>
            <CountryAutocomplete value={form.country} onChange={(code) => set("country", code)} />
          </div>
          <div>
            <label className="label" htmlFor="currency">{t("register.currency")}</label>
            <select id="currency" className={input} value={form.currency} onChange={(e) => set("currency", e.target.value)} required>
              {(currencies ?? [
                { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
                { code: "USD", name: "US Dollar", symbol: "$" },
              ]).map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink3">{t("register.walletHint")}</p>
          </div>

          <div>
            <label className="label" htmlFor="language">{t("register.language")}</label>
            <select id="language" className={input} value={form.language} onChange={(e) => set("language", e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="referral">{t("register.referral")}</label>
            <input id="referral" className={input} value={form.referralCode} onChange={(e) => set("referralCode", e.target.value)} placeholder="e.g. VOLT-X6HW" />
          </div>

          <div className="my-4 flex w-full flex-col items-center justify-center gap-3 text-center sm:col-span-2">
            <label className="flex w-full max-w-md cursor-pointer items-start gap-2 text-left text-sm text-ink2">
              <input type="checkbox" checked={form.terms} onChange={(e) => set("terms", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--vb-primary)]" required />
              <span>
                {t("register.termsPrefix")}{" "}
                <Link href="/terms" className="text-brand hover:underline">{t("register.termsLink")}</Link>{" "}
                {t("register.termsSuffix")}
              </span>
            </label>

            <RecaptchaGate onChange={setCaptchaToken} resetSignal={captchaReset} />
            <button
              className="btn btn-primary w-full max-w-md py-3"
              disabled={loading || !form.terms || (captchaRequired && !captchaToken)}
            >
              {loading ? t("register.submitting") : t("register.submit")}
            </button>
          </div>
        </form>

        <p className="mt-5 text-center text-sm text-ink2">
          {t("register.haveAccount")}{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">{t("nav.login")}</Link>
        </p>
      </div>
    </div>
  );
}
