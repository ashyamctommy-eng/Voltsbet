export default function ResponsibleGamblingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-extrabold">Responsible Gambling</h1>
      <p className="mt-2 text-sm text-ink2">Your wellbeing comes first. Betting should be fun, never a problem.</p>

      <div className="mt-6 space-y-4">
        <div className="card p-6">
          <h2 className="font-bold">Set limits</h2>
          <p className="mt-2 text-sm text-ink2">
            Use the tools in your account to set deposit limits, stake limits and session time limits. They help you stay in control.
          </p>
        </div>
        <div className="card p-6">
          <h2 className="font-bold">Self-exclusion</h2>
          <p className="mt-2 text-sm text-ink2">
            You can self-exclude from betting for a chosen period. During self-exclusion, betting and deposits are blocked on your account.
          </p>
        </div>
        <div className="card p-6">
          <h2 className="font-bold">Know the signs</h2>
          <p className="mt-2 text-sm text-ink2">
            Chasing losses, betting more than you can afford, borrowing to bet, and hiding betting from family are warning signs. If any of these sound familiar, take a break and reach out for help.
          </p>
        </div>
        <div className="card p-6">
          <h2 className="font-bold">Get help</h2>
          <p className="mt-2 text-sm text-ink2">
            Free, confidential support is available: <span className="font-semibold">BeGambleAware (UK)</span> — 0808 8020 133 ·{" "}
            <span className="font-semibold">Gambling Therapy</span> — gamblingtherapy.org · local helplines in your country.
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        18+. Please play responsibly. VoltBet does not offer betting to minors.
      </div>
    </div>
  );
}
