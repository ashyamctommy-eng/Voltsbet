"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { ShieldCheck } from "lucide-react";

type VoucherResult = {
  amount: number;
  currency: string;
  transactionId: string;
  newBalance: number;
};

type VoucherHistory = {
  id: string;
  amount: number;
  currencyCode: string;
  redeemedAt: string;
  reference: string | null;
};

type AccountData = {
  wallet: { balance: number; balanceLabel: string; currencyCode: string } | null;
  recentVoucherDeposits?: VoucherHistory[];
  user: { status: string };
};

/** Format a code as PREFIX-XXXX-XXXX-XXXX while typing. */
function formatCodeInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const groups = clean.match(/.{1,4}/g) ?? [];
  return groups.join("-").slice(0, 19); // TTB-XXXX-XXXX-XXXX = 19 chars
}

/**
 * Voucher deposit panel (Wallet → Deposit → Voucher).
 * The backend owns the voucher's value/currency/status — the user only
 * enters a code; the credited amount always comes from the server.
 */
export default function VoucherDeposit({ onSuccess }: { onSuccess?: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VoucherResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<VoucherHistory[]>([]);

  useEffect(() => {
    apiFetch<AccountData>("/api/account").then((r) => {
      if (r.ok) setHistory(r.data.recentVoucherDeposits ?? []);
    });
  }, []);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/-/g, "").length < 8) {
      setError(t("voucher.errorFullCode"));
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await apiFetch<VoucherResult>("/api/account/voucher/redeem", {
      method: "POST",
      body: { code },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setResult(res.data);
    setCode("");
    push("success", t("voucher.redeemed", { amount: res.data.amount.toLocaleString(), currency: res.data.currency }));
    onSuccess?.();
    apiFetch<AccountData>("/api/account").then((r) => r.ok && setHistory(r.data.recentVoucherDeposits ?? []));
  }

  return (
    <div className="space-y-4">
      {/* Redeem form */}
      <form onSubmit={redeem} className="card space-y-4 p-6">
        <div>
          <h3 className="text-base font-bold">{t("voucher.title")}</h3>
          <p className="mt-0.5 text-xs text-ink3">
            {t("voucher.subtitle")}
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-bold text-ink2">{t("voucher.code")}</span>
          <input
            className="input mt-1.5 w-full text-center font-mono text-lg font-bold tracking-[0.15em]"
            value={code}
            onChange={(e) => setCode(formatCodeInput(e.target.value))}
            placeholder="TTB-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={19}
            aria-label={t("voucher.code")}
          />
        </label>

        <button
          className="btn btn-primary w-full py-3"
          disabled={busy || code.replace(/-/g, "").length < 8}
          type="submit"
        >
          {busy ? t("voucher.redeeming") : t("voucher.redeem")}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-ink3">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          {t("voucher.secureNote")}
        </p>
      </form>

      {/* Result */}
      {result && (
        <div className="card border-green-500/30 bg-green-500/5 p-5 text-center">
          <div className="text-3xl">✅</div>
          <div className="mt-1 text-sm font-bold text-green-400">{t("voucher.successTitle")}</div>
          <div className="mt-2 text-2xl font-extrabold tabular-nums">
            +{result.amount.toLocaleString()} {result.currency}
          </div>
          <div className="mt-1 text-xs text-ink3">{t("voucher.transaction", { id: result.transactionId })}</div>
          <div className="text-xs text-ink2">
            {t("voucher.newBalance", { amount: result.newBalance.toLocaleString(), currency: result.currency })}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card border-red-500/30 bg-red-500/5 p-4 text-center text-sm text-red-400">{error}</div>
      )}

      {/* How it works */}
      <div className="card p-5 text-sm text-ink2">
        <h4 className="font-bold text-ink">{t("voucher.howTitle")}</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>{t("voucher.how1")}</li>
          <li>{t("voucher.how2")}</li>
          <li>{t("voucher.how3")}</li>
          <li>{t("voucher.how4")}</li>
        </ol>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card divide-y divide-line">
          <div className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink3">{t("voucher.history")}</div>
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-semibold">{t("voucher.historyItem")}</div>
                <div className="truncate text-xs text-ink3">
                  {new Date(h.redeemedAt).toLocaleString()}
                  {h.reference ? ` · ${h.reference}` : ""}
                </div>
              </div>
              <div className="font-bold text-green-400">
                +{h.amount.toLocaleString()}
                <span className="ml-1 text-[10px] font-medium text-ink3">({h.currencyCode})</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
