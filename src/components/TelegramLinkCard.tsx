"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type TelegramState = {
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
  botUsername: string | null;
  otpEnabled: boolean;
};

/** Telegram linking card — replaces the old 2FA card on account settings. */
export default function TelegramLinkCard() {
  const { push } = useToast();
  const [state, setState] = useState<TelegramState | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<TelegramState>("/api/account/telegram").then((r) => r.ok && setState(r.data));
  }, []);

  async function createLink() {
    setBusy(true);
    const res = await apiFetch<{ url: string }>("/api/account/telegram", { method: "POST", body: {} });
    setBusy(false);
    if (!res.ok) return push("error", res.error.message);
    setLinkUrl(res.data.url);
    window.open(res.data.url, "_blank", "noopener");
  }

  async function unlink() {
    if (!confirmingUnlink) {
      setConfirmingUnlink(true);
      return;
    }
    setBusy(true);
    const res = await apiFetch<{ message: string }>("/api/account/telegram", { method: "DELETE", body: {} });
    setBusy(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    setState((s) => (s ? { ...s, linked: false, username: null, linkedAt: null } : s));
    setConfirmingUnlink(false);
  }

  if (!state) return null;

  if (!state.botUsername) {
    return (
      <div className="card p-5">
        <h3 className="font-bold">Telegram Verification</h3>
        <p className="mt-1 text-sm text-ink3">Telegram login codes are not configured on this platform yet.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="font-bold">Telegram Verification</h3>
      <p className="mt-1 text-sm text-ink2">
        Link your Telegram to receive login verification codes{state.otpEnabled ? " — required at login on this platform" : ""}.
      </p>

      {state.linked ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-brand">
            <span className="h-2.5 w-2.5 rounded-full bg-brand" />
            Linked {state.username ? `as @${state.username}` : ""}
          </span>
          {confirmingUnlink ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink2">Unlink? Login codes will stop.</span>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={unlink}>
                {busy ? "Working…" : "Confirm"}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmingUnlink(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={unlink}>
              Unlink
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink2">
            <li>Tap <b className="text-ink">Link Telegram</b> — it opens our bot with your personal token.</li>
            <li>Press <b className="text-ink">Start</b> in Telegram. That&apos;s it.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={createLink}>
              {busy ? "Generating…" : "Link Telegram"}
            </button>
            {linkUrl && (
              <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-brand hover:underline">
                {linkUrl}
              </a>
            )}
          </div>
          <p className="text-[11px] text-ink3">The link is single-use and expires after 15 minutes.</p>
        </div>
      )}
    </div>
  );
}
