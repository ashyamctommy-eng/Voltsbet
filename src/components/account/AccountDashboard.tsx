"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import CopyButton from "@/components/CopyButton";
import { IconGift } from "@/components/icons";
import { formatDateTime, statusColor } from "@/lib/odds";

export type AccountDashboardProps = {
  bettingLockReason: string | null;
  balanceLabel: string;
  /** Converted figure for the display currency, or null when they match. */
  displayLabel: string | null;
  displayCur: string;
  /** Withdrawals still being processed — what the player is waiting on. */
  pendingPayouts: number;
  bonusLabel: string | null;
  /** First successful deposit completed → bonus balance unlocked for betting. */
  hasDeposited: boolean;
  walletCur: string;
  userStatus: string;
  verified: boolean;
  appUrl: string;
  referralCode: string | null;
  openBets: {
    id: string;
    code: string;
    type: string;
    status: string;
    totalOdds: number;
    stake: number;
    potentialWin: number;
    selections: { outcomeName: string }[];
  }[];
  transactions: {
    id: string;
    type: string;
    reason: string | null;
    amount: number;
    currencyCode: string;
    createdAt: string;
  }[];
};

/**
 * Account dashboard — client-side so every label (balance card, quick stats,
 * referral card, open-bets + transactions widgets) runs through react-i18next
 * and follows the selected language. Data is fetched server-side and passed
 * in as plain, serializable props.
 */
export default function AccountDashboard(props: AccountDashboardProps) {
  const { t } = useTranslation();
  const {
    bettingLockReason,
    balanceLabel,
    displayLabel,
    displayCur,
    pendingPayouts,
    bonusLabel,
    hasDeposited,
    walletCur,
    appUrl,
    referralCode,
    openBets,
    transactions,
  } = props;

  return (
    <div className="space-y-5">
      {bettingLockReason && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm dark:text-amber-200 text-amber-700">
          ⚠️ {bettingLockReason}
        </div>
      )}

      {/* Balance card */}
      <div className="card relative overflow-hidden p-6">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/15" />
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t("dashboard.available_balance")} · {walletCur}
        </div>
        <div className="mt-1 text-3xl font-extrabold text-ink tabular-nums">{balanceLabel}</div>
        {displayLabel && (
          <div className="mt-1 text-xs text-ink3">
            ≈ {displayLabel} in {displayCur} · withdrawals settle in {walletCur}
          </div>
        )}
        {bonusLabel && (
          <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">{t("dashboard.bonus_balance", { label: bonusLabel })}</div>
        )}
        {bonusLabel && !hasDeposited && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
            {t("dashboard.bonus_locked_hint", {
              defaultValue: "Locked - make your first deposit to unlock it for betting",
            })}
          </div>
        )}
        <div className="mt-5 flex gap-3">
          <Link href="/account/deposit" className="btn btn-primary btn-sm">+ {t("common.deposit")}</Link>
          <Link href="/account/withdraw" className="btn btn-ghost btn-sm">{t("nav.withdraw")}</Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Attention-first: what a player is waiting on or can act on. Status and
            verification moved to the account header, where they gate withdrawals. */}
        <Stat label={t("dashboard.open_bets")} value={openBets.length.toString()} />
        <Stat label="Awaiting payout" value={pendingPayouts.toString()} accent={pendingPayouts === 0} />
        <Stat label="Bonus balance" value={bonusLabel ?? "—"} />
        <Stat label={t("dashboard.currency")} value={displayCur} />
      </div>

      {/* Referral */}
      {referralCode && (
        <section className="card relative overflow-hidden p-5">
          <div className="absolute -left-8 -top-10 h-32 w-32 rounded-full bg-brand/10 blur-xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-bold">
                <IconGift className="h-5 w-5 text-brand-text" /> {t("referral.title")}
              </h2>
              <p className="mt-1 text-sm text-ink2">{t("referral.subtitle")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-sm text-brand-text">
                  {referralCode}
                </code>
                <CopyButton
                  text={`${appUrl ? appUrl.replace(/\/$/, "") : ""}/register?ref=${referralCode}`}
                  label={t("referral.copy_link")}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Open bets */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">{t("dashboard.open_bets")}</h2>
          <Link href="/account/bets" className="text-sm font-semibold text-brand-text hover:underline">{t("common.view_all")} →</Link>
        </div>
        {openBets.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink3">
            {t("dashboard.no_open_bets")}{" "}
            <Link href="/sports" className="text-brand-text hover:underline">{t("dashboard.find_match")} →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {openBets.map((bet) => (
              <div key={bet.id} className="card p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold">
                    {bet.code} · {bet.type === "MULTIPLE" ? t("betslip.fold", { count: bet.selections.length }) : t("betslip.singles")}
                  </span>
                  <span className={`text-xs font-bold ${statusColor(bet.status)}`}>{bet.status}</span>
                </div>
                <div className="mt-2 text-xs text-ink2">
                  {bet.selections.map((s) => s.outcomeName).join(" · ") || "—"}
                </div>
                <div className="mt-2 flex gap-4 text-xs text-ink2">
                  <span>{t("dashboard.odds")} <b className="text-ink">{bet.totalOdds.toFixed(2)}</b></span>
                  <span>{t("dashboard.stake")} <b className="text-ink">{bet.stake.toLocaleString()}</b></span>
                  <span>{t("dashboard.potential")} <b className="text-green-400">{bet.potentialWin.toLocaleString()}</b></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent transactions */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">{t("dashboard.recent_transactions")}</h2>
          <Link href="/account/transactions" className="text-sm font-semibold text-brand-text hover:underline">{t("common.view_all")} →</Link>
        </div>
        {transactions.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink3">{t("dashboard.no_transactions")}</div>
        ) : (
          <div className="card divide-y divide-line">
            {transactions.map((tr) => (
              <div key={tr.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-semibold capitalize">{tr.type.replace("_", " ")}</div>
                  <div className="text-xs text-ink3">{formatDateTime(new Date(tr.createdAt))} {tr.reason ? `· ${tr.reason}` : ""}</div>
                </div>
                <div className={`font-bold ${tr.amount >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {tr.amount >= 0 ? "+" : ""}{tr.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {tr.currencyCode}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent = true }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink3">{label}</div>
      <div className={`mt-1 truncate text-lg font-bold ${accent ? "" : "dark:text-amber-400 text-amber-600"}`}>{value}</div>
    </div>
  );
}
