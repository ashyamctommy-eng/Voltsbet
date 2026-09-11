/**
 * Branded maintenance screen. Shared by:
 *   - `app/maintenance/page.tsx` (env kill-switch via proxy.ts)
 *   - the root layout gate (DB toggle from Admin → Website Settings)
 *
 * Deliberately presentational and dependency-free (no hooks, no data access)
 * so it is safe to render from either place.
 */
export default function MaintenanceScreen({
  brand = "Sportsbook",
  message,
}: {
  brand?: string;
  message?: string;
}) {
  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/15 text-3xl">🛠️</span>
      <h1 className="mt-5 text-2xl font-extrabold text-ink">We&apos;ll be right back</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink2">
        {brand} is undergoing scheduled maintenance and will be back shortly.
      </p>
      {message && <p className="mt-2 text-sm font-medium text-ink">{message}</p>}
      <p className="mt-1 text-xs text-ink3">
        Your balance and open bets are safe. Pending bets will settle normally.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {/* Deliberately a plain anchor (full reload, no client JS needed) —
            the user may still be mid-maintenance when they click it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="btn btn-primary px-6 py-2.5">
          Reload
        </a>
        <a href="/responsible-gambling" className="btn btn-ghost px-6 py-2.5">
          Responsible gambling
        </a>
      </div>
      <p className="mt-6 text-[11px] text-ink3">18+ · Play responsibly</p>
    </main>
  );
}
