"use client";

/**
 * Forgot password — Telegram-delivered reset code.
 *
 * Two steps: identify → code + new password. The Telegram code is the proof.
 * Accounts without Telegram linked are told to contact support rather than
 * being left on a dead end; the API response never reveals which case applies,
 * so this page must not either.
 */

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ message: string }>("/api/auth/forgot", {
      method: "POST",
      body: { identifier },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setNotice(res.data.message);
    setStep(2);
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ message: string }>("/api/auth/reset", {
      method: "POST",
      body: { identifier, code, newPassword: password },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-6 text-center">
          <h1 className="text-lg font-bold">Password updated</h1>
          <p className="mt-2 text-sm text-ink2">
            Every device has been signed out. Sign in with your new password.
          </p>
          <Link href="/login" className="btn btn-primary mt-4 inline-flex">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card space-y-4 p-6">
        <div>
          <h1 className="text-lg font-bold">Reset your password</h1>
          <p className="mt-1 text-[11px] text-ink3">
            We send a one-time code to your linked Telegram — no email or SMS needed.
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={requestCode} className="space-y-4">
            <div>
              <label className="label" htmlFor="ident">Email or username</label>
              <input
                id="ident"
                className="input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            {error && <p className="text-[11px] font-semibold text-bad">{error}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy || !identifier}>
              {busy ? "Sending…" : "Send code"}
            </button>
            <p className="text-[11px] text-ink3">
              No Telegram linked? Contact support to have your password reset.
            </p>
          </form>
        ) : (
          <form onSubmit={submitReset} className="space-y-4">
            {notice && (
              <p className="rounded-lg border border-line bg-card2/60 px-3 py-2 text-[11px] text-ink2">{notice}</p>
            )}
            <div>
              <label className="label" htmlFor="code">Code from Telegram</label>
              <input
                id="code"
                className="input font-mono text-sm tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="newpw">New password</label>
              <input
                id="newpw"
                className="input font-mono text-xs"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="mt-1 text-[11px] text-ink3">At least 8 characters, with a letter and a number.</p>
            </div>
            <div>
              <label className="label" htmlFor="conf">Confirm new password</label>
              <input
                id="conf"
                className="input font-mono text-xs"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {confirm.length > 0 && password !== confirm && (
                <p className="mt-1 text-[11px] font-semibold text-bad">Passwords don&apos;t match.</p>
              )}
            </div>
            {error && <p className="text-[11px] font-semibold text-bad">{error}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy || !code || password.length < 8}>
              {busy ? "Updating…" : "Set new password"}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => { setStep(1); setError(null); }}
              disabled={busy}
            >
              Use a different account
            </button>
          </form>
        )}

        <p className="text-center text-[11px] text-ink3">
          <Link href="/login" className="hover:text-ink">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
