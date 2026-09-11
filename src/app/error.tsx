"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route error boundary — catches errors thrown while rendering a page
 * (a failed query, an unhandled exception, a provider hiccup) and shows a
 * branded, on-theme recovery screen instead of a raw error. Rendered INSIDE
 * the root layout, so the header/footer and theme still apply.
 *
 * `reset()` re-renders the failed segment; if the cause was transient that
 * recovers in place without a full reload.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[voltbet] route error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="relative flex h-16 w-16 items-center justify-center">
        <span aria-hidden className="ring-pulse absolute inset-0 rounded-full bg-amber-500/15" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-2xl font-black text-amber-400">
          !
        </span>
      </span>

      <h1 className="mt-5 text-xl font-extrabold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink2">
        This page hit an unexpected error. Your balance and bets are safe — retrying usually fixes it.
      </p>

      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <button onClick={() => reset()} className="btn btn-primary px-6 py-2.5">
          Try again
        </button>
        <Link href="/" className="btn btn-ghost px-6 py-2.5 text-center">
          Go to homepage
        </Link>
      </div>

      {error.digest && (
        <p className="mt-5 font-mono text-[11px] text-ink3">Reference: {error.digest}</p>
      )}
    </main>
  );
}
