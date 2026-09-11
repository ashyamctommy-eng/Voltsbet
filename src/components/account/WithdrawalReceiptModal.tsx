"use client";

import { CheckCircle2, Clock3, Smartphone, Wallet } from "lucide-react";
import { useCurrency } from "@/components/CurrencyProvider";

/**
 * Withdrawal success receipt.
 *
 * Shown after a withdrawal request is accepted (funds reserved). It is a
 * receipt, not a settlement notice — the request still goes through the admin
 * payout queue — so the copy says "requested/processing", never "paid".
 */

export type WithdrawalReceipt = {
  id: string;
  trackingId: string;
  amount: number;
  currencyCode: string;
  destination: string;
  method: "CRYPTO" | "MPESA";
};

/** Deterministic 10-char confirmation code from the withdrawal id. */
export function confirmationCode(seed: string): string {
  const cleaned = seed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.slice(-10).padStart(10, "0");
}

export default function WithdrawalReceiptModal({
  receipt,
  onClose,
}: {
  receipt: WithdrawalReceipt;
  onClose: () => void;
}) {
  const { formatCurrency } = useCurrency();
  const code = confirmationCode(receipt.id || receipt.trackingId);
  const isMpesa = receipt.method === "MPESA";

  return (
    <>
      <div className="fade-in fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="pop-in card w-full max-w-md overflow-hidden">
          {/* ── Success header ─────────────────────────────────── */}
          <div className="relative flex flex-col items-center gap-3 border-b border-line bg-gradient-to-b from-brand/10 to-transparent px-6 pb-5 pt-7 text-center">
            <span className="relative flex h-16 w-16 items-center justify-center">
              <span aria-hidden className="ring-pulse absolute inset-0 rounded-full bg-brand/20" />
              <span className="pop-in relative flex h-14 w-14 items-center justify-center rounded-full bg-brand text-[#052e16] shadow-lg shadow-brand/30">
                <CheckCircle2 className="h-8 w-8" strokeWidth={2.4} />
              </span>
            </span>
            <div>
              <h3 className="text-lg font-extrabold text-ink">Withdrawal Requested</h3>
              <p className="mt-0.5 text-xs text-ink2">
                Your request is in the payout queue and being processed.
              </p>
            </div>
            <span className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 font-mono text-xs font-bold tracking-wide text-brand">
              Confirmation #{code}
            </span>
          </div>

          {/* ── Itemised details ───────────────────────────────── */}
          <div className="divide-y divide-line/70 px-6">
            <Detail icon={<Wallet className="h-4 w-4" />} label="Requested Amount">
              <span className="font-extrabold text-ink">
                {formatCurrency(receipt.amount, receipt.currencyCode)}
              </span>
            </Detail>
            <Detail icon={<Smartphone className="h-4 w-4" />} label={isMpesa ? "M-PESA Number" : "Destination"}>
              <span className="font-mono text-xs font-semibold text-ink">{receipt.destination}</span>
            </Detail>
            <Detail label="Reference Code">
              <span className="font-mono text-xs font-semibold text-brand">{receipt.trackingId}</span>
            </Detail>
            <Detail label="Processing Fee">
              <span className="text-sm font-semibold text-green-400">Free</span>
            </Detail>
            <Detail icon={<Clock3 className="h-4 w-4" />} label="Estimated Settlement">
              <span className="text-sm font-semibold text-ink">&lt; 2 mins</span>
            </Detail>
          </div>

          {/* ── Footer note + actions ──────────────────────────── */}
          <div className="space-y-4 px-6 pb-6 pt-5">
            <p className="rounded-xl border border-line bg-card2/60 px-3.5 py-2.5 text-center text-[11px] leading-relaxed text-ink2">
              {isMpesa
                ? "You will receive an M-PESA confirmation SMS shortly. Keep your phone on and reachable."
                : "You will receive a confirmation once the payout is broadcast to the network."}
            </p>
            <button className="btn btn-primary w-full py-3" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-ink3">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
