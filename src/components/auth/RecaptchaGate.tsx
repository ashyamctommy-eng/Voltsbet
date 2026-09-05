"use client";

import { useEffect, useRef } from "react";
import ReCAPTCHA from "react-google-recaptcha";

/**
 * Google reCAPTCHA v2 checkbox gate for the auth pages.
 *
 * Renders the widget only when NEXT_PUBLIC_RECAPTCHA_SITE_KEY is configured
 * (it is inlined at build time). When unconfigured it renders nothing and
 * reports `null`, so local/dev environments without keys are unaffected.
 *
 * Props:
 *  - onChange(token): called with the fresh token, or null on expire/reset.
 *  - resetSignal: bump this counter to force a widget reset (single-use
 *    tokens must be refreshed after a failed submit).
 */
export default function RecaptchaGate({
  onChange,
  resetSignal = 0,
}: {
  onChange: (token: string | null) => void;
  resetSignal?: number;
}) {
  const ref = useRef<ReCAPTCHA | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  useEffect(() => {
    if (resetSignal > 0) {
      ref.current?.reset();
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <div className="flex justify-center [&>div]:scale-[0.92] sm:block">
      <ReCAPTCHA
        ref={ref}
        sitekey={siteKey}
        onChange={(token) => onChange(token ?? null)}
        onExpired={() => onChange(null)}
      />
    </div>
  );
}
