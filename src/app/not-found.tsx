import Link from "next/link";

/** Branded 404 — every unmatched route and explicit notFound() lands here. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="text-6xl font-black tracking-tight text-brand">404</span>
      <h1 className="mt-4 text-xl font-extrabold text-ink">Page not found</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink2">
        The page you&apos;re looking for has moved or no longer exists.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href="/" className="btn btn-primary px-6 py-2.5 text-center">
          Back to homepage
        </Link>
        <Link href="/live" className="btn btn-ghost px-6 py-2.5 text-center">
          Live betting
        </Link>
      </div>
    </main>
  );
}
