"use client";

/**
 * Change password — Path A: proof is the CURRENT password, not an out-of-band
 * code. No SMS or email provider required, so this works on any deployment.
 *
 * The confirmation field is deliberate: a typo'd new password would otherwise
 * lock the customer out of their own account permanently, since there is no
 * self-service reset yet.
 */

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

export default function ChangePasswordCard() {
  const { push } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !!current && next.length >= 8 && next === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    const res = await apiFetch<{ message: string }>("/api/account/password", {
      method: "POST",
      body: { currentPassword: current, newPassword: next },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    push("success", res.data.message);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
        <h3 className="font-bold">Security</h3>
        <p className="mt-1 text-[11px] text-ink3">
          Choose a password you don&apos;t use anywhere else. At least 8 characters, with a letter and a number.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          className="input font-mono text-xs"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pw-new">New password</label>
          <input
            id="pw-new"
            className="input font-mono text-xs"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="pw-confirm">Confirm new password</label>
          <input
            id="pw-confirm"
            className="input font-mono text-xs"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="mt-1 text-[11px] font-semibold text-bad">Passwords don&apos;t match.</p>}
        </div>
      </div>

      {error && <p className="text-[11px] font-semibold text-bad">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {busy ? "Updating…" : "Change password"}
        </button>
        <span className="text-[11px] text-ink3">
          You&apos;ll stay signed in here — every other device is signed out.
        </span>
      </div>
    </form>
  );
}
