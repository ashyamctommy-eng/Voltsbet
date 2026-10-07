/**
 * Shared route-level loading skeleton.
 *
 * Two jobs: (1) paint something instantly on a tab switch instead of a blank
 * wait, and (2) give Next a boundary to prefetch to — with `staleTimes.dynamic`
 * at its default of 0 and NO loading boundary, <Link> prefetch could not warm
 * a dynamic segment at all, which is the structural reason tab switches felt
 * unresponsive (2026-10-07).
 */
export default function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-[1600px] px-4" aria-busy="true" aria-live="polite">
      <div className="mt-6 h-7 w-48 animate-pulse rounded-lg bg-hover-tint" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-hover-tint" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="card p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="h-3 w-32 animate-pulse rounded bg-hover-tint" />
              <div className="h-3 w-16 animate-pulse rounded bg-hover-tint" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-hover-tint" />
                <div className="h-4 w-32 animate-pulse rounded bg-hover-tint" />
              </div>
              <div className="flex shrink-0 gap-2">
                <div className="h-8 w-14 animate-pulse rounded bg-hover-tint" />
                <div className="h-8 w-14 animate-pulse rounded bg-hover-tint" />
                <div className="h-8 w-14 animate-pulse rounded bg-hover-tint" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
