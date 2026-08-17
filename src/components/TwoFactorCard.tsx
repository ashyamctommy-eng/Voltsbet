"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type TwoFaState = {
  enabled: boolean;
  secret?: string;
  qrDataUrl?: string;
  otpauthUrl?: string;
};

/** 2FA enrollment card — shown to admin/staff on the account settings page. */
export default function TwoFactorCard() {
  const { push } = useToast();
  const [state, setState] = useState<TwoFaState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<TwoFaState>("/api/account/2fa").then((r) => r.ok && setState(r.data));
  }, []);

  async function enable() {
    setBusy(true);
    const res = await apiFetch<{ message: string }>("/api/account/2fa", { method: "POST", body: { code } });
    setBusy(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    setState((s) => (s ? { ...s, enabled: true } : s));
    setCode("");
  }

  async function disable() {
    setBusy(true);
    const res = await apiFetch<{ message: string }>("/api/account/2fa", { method: "DELETE", body: {} });
    setBusy(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    setState({ enabled: false });
  }

  if (!state) return null;

  return (
    <div className="card p-5">
      <h3 className="font-bold">Two-Factor Authentication (2FA)</h3>
      <p className="mt-1 text-sm text-ink2">
        Extra security for staff logins — you'll enter a 6-digit code from your authenticator app after your password.
      </p>

      {state.enabled ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-brand">
            <span className="h-2.5 w-2.5 rounded-full bg-brand" /> Enabled
          </span>
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={disable}>
            {busy ? "Working…" : "Disable 2FA"}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-5 sm:grid-cols-[auto_1fr]">
          {state.qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.qrDataUrl}
              alt="Scan with your authenticator app"
              className="rounded-xl border border-line bg-white p-2"
              width={220}
              height={220}
            />
          )}
          <div className="space-y-3">
            <p className="text-sm text-ink2">
              1. Scan the QR with <b className="text-ink">Google Authenticator</b> or <b className="text-ink">Authy</b>.
            </p>
            {state.otpauthUrl && (
              <p className="break-all rounded-lg bg-[#0d1526] px-3 py-2 font-mono text-[11px] text-ink3">
                {state.otpauthUrl}
              </p>
            )}
            <div className="flex gap-2">
              <input
                className="input w-40 font-mono"
                placeholder="6-digit code"
                maxLength={6}
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={enable}>
                {busy ? "Verifying…" : "Enable"}
              </button>
            </div>
            <p className="text-[11px] text-ink3">
              2. Enter the current code to confirm. Keep your backup secret safe — losing it locks you out.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
