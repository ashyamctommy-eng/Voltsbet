"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCurrency } from "@/components/CurrencyProvider";

/**
 * M-Pesa STK-push status modal.
 *
 * Lifecycle: dispatch the STK push → open this modal → count down 60 s while
 * polling the status endpoint every 3 s. Paid → success. Any other terminal
 * status → failure. Countdown hits zero → fire the TIMEOUT_CANCELLED event
 * and switch to a clean "timed out / retry" view.
 *
 * The countdown is client-side and cosmetic: a payment that lands even a few
 * seconds after the window still credits the wallet (the backend keeps the
 * deposit creditable on timeout — see /api/payments/check-status).
 */

export type MpesaPending = {
  id: string;
  amount: number;
  phone: string;
  currencyCode: string;
};

const WINDOW_SECONDS = 60;
const POLL_MS = 3000;
const R = 54;
const CIRC = 2 * Math.PI * R;

type Phase = "waiting" | "success" | "timeout" | "failed";

export default function MpesaDepositModal({
  deposit,
  onClose,
  onConfirmed,
  onRetry,
}: {
  deposit: MpesaPending;
  onClose: () => void;
  onConfirmed: () => void;
  onRetry: () => void;
}) {
  const { formatCurrency } = useCurrency();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [secondsLeft, setSecondsLeft] = useState(WINDOW_SECONDS);
  const [failureStatus, setFailureStatus] = useState<string | null>(null);

  const depositId = deposit.id;
  // Parent renders this modal with key={deposit.id}, so a retry fully remounts
  // it — the state machine below is fresh per attempt and needs no reset effect.
  const settled = useRef(false);
  const confirmed = useRef(false);
  // Keep the latest callbacks in a ref: the parent re-creates them on every
  // render, and depending on their identity would restart the poll interval.
  const cbs = useRef({ onConfirmed, onClose });
  useEffect(() => {
    cbs.current = { onConfirmed, onClose };
  });

  const timeout = useCallback(async () => {
    if (settled.current) return;
    settled.current = true;
    setPhase("timeout");
    // Agent 1 requirement: emit the cancellation event to the backend.
    await apiFetch("/api/payments/check-status", {
      method: "POST",
      body: { depositId, event: "TIMEOUT_CANCELLED" },
    }).catch(() => null);
  }, [depositId]);

  // 1-second countdown.
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [phase, depositId]);

  // Auto-cancel when the window lapses.
  useEffect(() => {
    if (phase === "waiting" && secondsLeft <= 0) void timeout();
  }, [phase, secondsLeft, timeout]);

  // Poll every 3 s (immediately on open, so a fast PIN registers at once).
  useEffect(() => {
    if (phase !== "waiting") return;
    let stop = false;
    const poll = async () => {
      const res = await apiFetch<{ deposit: { status: string } }>(
        `/api/payments/check-status?depositId=${encodeURIComponent(depositId)}`
      );
      if (stop || settled.current || !res.ok) return;
      const status = res.data.deposit.status;
      if (status === "COMPLETED") {
        settled.current = true;
        setPhase("success");
        if (!confirmed.current) {
          confirmed.current = true;
          cbs.current.onConfirmed();
        }
      } else if (["FAILED", "EXPIRED", "CANCELLED"].includes(status)) {
        settled.current = true;
        setFailureStatus(status);
        setPhase("failed");
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [phase, depositId]);

  // Auto-dismiss the success view so the user gets back to the page.
  useEffect(() => {
    if (phase !== "success") return;
    const id = setTimeout(() => cbs.current.onClose(), 4000);
    return () => clearTimeout(id);
  }, [phase]);

  const fraction = Math.max(0, Math.min(1, secondsLeft / WINDOW_SECONDS));
  const stroke =
    phase === "success"
      ? "#00e676"
      : fraction > 0.5
        ? "#00e676"
        : fraction > 0.2
          ? "#f59e0b"
          : "#ef4444";
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  return (
    <>
      <div className="fade-in fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={phase === "waiting" ? undefined : onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="rise-in card w-full max-w-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mpesaicon.png" alt="M-PESA" className="h-6 w-6 rounded-full object-cover" />
              <span className="text-sm font-bold text-ink">M-PESA Deposit</span>
            </div>
            {phase !== "waiting" && (
              <button className="text-ink3 transition-colors hover:text-ink" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {phase === "waiting" && (
            <div className="flex flex-col items-center px-6 pb-6 pt-7 text-center">
              {/* Countdown ring + live spinner */}
              <div className="relative flex h-36 w-36 items-center justify-center">
                <span aria-hidden className="ring-pulse absolute inset-3 rounded-full bg-brand/10" />
                <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
                  <circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" stroke="currentColor" className="text-line" />
                  <circle
                    cx="60"
                    cy="60"
                    r={R}
                    fill="none"
                    stroke={stroke}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={CIRC}
                    strokeDashoffset={CIRC * (1 - fraction)}
                    style={{ transition: "stroke-dashoffset 1s linear, stroke 0.4s ease" }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-extrabold tabular-nums text-ink">
                    {mm}:{String(ss).padStart(2, "0")}
                  </span>
                  <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-ink3">
                    remaining
                  </span>
                </div>
              </div>

              <h3 className="mt-4 text-base font-extrabold text-ink">Processing…</h3>
              <p className="mt-1 text-sm leading-snug text-ink2">
                Please check your phone for the <span className="font-semibold text-brand">M-PESA</span> prompt and enter your PIN.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-full border border-line bg-card2/60 px-3 py-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                </span>
                <span className="text-[11px] font-semibold text-ink2">Waiting for payment confirmation</span>
              </div>

              {/* Details */}
              <div className="mt-5 w-full space-y-2 rounded-xl border border-line bg-card2/40 p-3 text-left">
                <Row label="Amount">
                  <span className="font-bold text-ink">{formatCurrency(deposit.amount, deposit.currencyCode)}</span>
                </Row>
                <Row label="M-PESA Number">
                  <span className="font-mono text-xs font-semibold text-ink">{deposit.phone}</span>
                </Row>
              </div>
            </div>
          )}

          {phase === "success" && (
            <div className="flex flex-col items-center px-6 pb-7 pt-8 text-center">
              <span className="pop-in flex h-16 w-16 items-center justify-center rounded-full bg-brand text-[#052e16] shadow-lg shadow-brand/30">
                <CheckCircle2 className="h-9 w-9" strokeWidth={2.4} />
              </span>
              <h3 className="mt-4 text-lg font-extrabold text-ink">Payment Received</h3>
              <p className="mt-1 text-sm text-ink2">
                <span className="font-bold text-brand">{formatCurrency(deposit.amount, deposit.currencyCode)}</span> has been
                credited to your balance.
              </p>
              <button className="btn btn-primary mt-5 w-full py-3" onClick={onClose}>
                Done
              </button>
            </div>
          )}

          {(phase === "timeout" || phase === "failed") && (
            <div className="flex flex-col items-center px-6 pb-7 pt-8 text-center">
              <span className="pop-in flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                <X className="h-8 w-8" strokeWidth={2.6} />
              </span>
              <h3 className="mt-4 text-lg font-extrabold text-ink">
                {phase === "timeout" ? "Transaction Timed Out" : "Payment Not Completed"}
              </h3>
              <p className="mt-1 text-sm leading-snug text-ink2">
                {phase === "timeout"
                  ? "We didn't receive your M-PESA confirmation in time. The request was cancelled — you can safely try again."
                  : `M-PESA did not confirm this payment (${failureStatus?.toLowerCase() ?? "failed"}). No money has left your account.`}
              </p>
              <button className="btn btn-primary mt-5 flex w-full items-center justify-center gap-2 py-3" onClick={onRetry}>
                <RefreshCw className="h-4 w-4" />
                Retry Payment
              </button>
              <button className="btn btn-ghost mt-2 w-full" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium text-ink3">{label}</span>
      {children}
    </div>
  );
}
