"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { useTranslation } from "react-i18next";
import RecaptchaGate from "@/components/auth/RecaptchaGate";
import { apiErrorText } from "@/lib/api-error-text";
import { useSiteName } from "@/components/SiteSettingsContext";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const siteName = useSiteName();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  // reCAPTCHA v2 — widget + single-use token (enforced only when the site key
  // is configured at build time).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaRequired = !!process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  function bumpCaptchaReset() {
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (captchaRequired && !captchaToken) {
      setError(t("login.captchaRequired"));
      return;
    }
    setLoading(true);
    const res = await apiFetch<{ redirect: string; otpRequired?: boolean; message?: string }>("/api/auth/login", {
      method: "POST",
      body: { identifier, password, remember, gRecaptchaToken: captchaToken ?? "", ...(otp ? { otp } : {}) },
    });
    setLoading(false);
    if (!res.ok) {
      // A failed OTP attempt keeps the OTP step visible so the user can retry
      if (res.error.code !== "OTP_INVALID") setOtpRequired(false);
      setError(apiErrorText(t, res.error.code, res.error.message));
      bumpCaptchaReset();
      return;
    }
    if (res.data.otpRequired) {
      setOtpRequired(true);
      setNotice(res.data.message ?? t("login.otpNotice"));
      // The solved token is spent — the OTP step shows a fresh widget.
      bumpCaptchaReset();
      return;
    }
    // Smart auth redirect: ?redirect=/account/deposit (betslip insufficient-
    // balance flow) wins over the server's role-based default destination.
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    router.push(redirect && redirect.startsWith("/") ? redirect : (res.data.redirect ?? "/"));
    router.refresh();
  }

  function resetOtpStep() {
    setOtpRequired(false);
    setOtp("");
    setError("");
    setNotice("");
    bumpCaptchaReset();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-ink2">{t("login.subtitle")}</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
          {notice && <div className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-text">{notice}</div>}

          {!otpRequired ? (
            <>
              <div>
                <label className="label" htmlFor="identifier">{t("login.identifier")}</label>
                <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
              </div>
              <div>
                <label className="label" htmlFor="password">{t("login.password")}</label>
                <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <div className="flex items-center justify-between text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-ink2">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--vb-primary)]" />
                  {t("login.remember")}
                </label>
                <Link href="/forgot" className="text-ink3 hover:text-ink">{t("login.forgot")}</Link>
              </div>
              <RecaptchaGate onChange={setCaptchaToken} resetSignal={captchaReset} />
              <button className="btn btn-primary w-full py-3" disabled={loading || (captchaRequired && !captchaToken)}>
                {loading ? t("login.submitting") : t("login.submit")}
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="otp">{t("login.otpLabel")}</label>
                <input
                  id="otp"
                  className="input text-center font-mono text-lg tracking-[0.5em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  autoFocus
                  required
                />
                <p className="mt-1.5 text-xs text-ink3">{t("login.otpHint")}</p>
              </div>
              <RecaptchaGate onChange={setCaptchaToken} resetSignal={captchaReset} />
              <button
                className="btn btn-primary w-full py-3"
                disabled={loading || otp.length !== 6 || (captchaRequired && !captchaToken)}
              >
                {loading ? t("login.verifying") : t("login.verify")}
              </button>
              <button type="button" className="w-full text-center text-sm text-ink3 hover:text-ink" onClick={resetOtpStep}>
                {t("login.backToPassword")}
              </button>
            </>
          )}
        </form>

        <p className="mt-5 text-center text-sm text-ink2">
          {siteName.trim() ? t("login.newTo", { siteName: siteName.trim() }) : t("login.newHere")}{" "}
          <Link href="/register" className="font-semibold text-brand-text hover:underline">{t("login.createAccount")}</Link>
        </p>
      </div>
    </div>
  );
}
