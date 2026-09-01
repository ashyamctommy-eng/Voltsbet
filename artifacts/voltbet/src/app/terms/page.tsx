export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-extrabold">Terms & Conditions</h1>
      <p className="mt-1 text-sm text-ink3">Last updated: August 2026. Demo platform — these terms are illustrative.</p>
      <div className="mt-6 space-y-5 text-sm text-ink2 leading-relaxed">
        <div className="card p-6">
          <h2 className="mb-2 font-bold text-ink">1. Eligibility</h2>
          <p>You must be 18 or older (or the legal gambling age in your jurisdiction) to use this platform. Accounts may be verified before withdrawals are processed.</p>
        </div>
        <div className="card p-6">
          <h2 className="mb-2 font-bold text-ink">2. Deposits & withdrawals</h2>
          <p>Deposits are credited after on-chain confirmation. Withdrawals are subject to review and may require identity verification. Funds are settled in your account currency.</p>
        </div>
        <div className="card p-6">
          <h2 className="mb-2 font-bold text-ink">3. Betting rules</h2>
          <p>Bets are accepted at the odds displayed at confirmation. If odds change, you are asked to confirm before the bet is placed. Markets may be suspended at any time; bets on suspended selections are rejected. Voided selections refund the stake (accumulators are voided in full).</p>
        </div>
        <div className="card p-6">
          <h2 className="mb-2 font-bold text-ink">4. Responsible gambling</h2>
          <p>Deposit limits, session limits and self-exclusion are available. We reserve the right to close accounts used irresponsibly.</p>
        </div>
        <div className="card p-6">
          <h2 className="mb-2 font-bold text-ink">5. Account misuse</h2>
          <p>Multiple accounts, bonus abuse, automated betting and fraud result in suspension and forfeiture of winnings. All adjustments are audited.</p>
        </div>
      </div>
    </div>
  );
}
