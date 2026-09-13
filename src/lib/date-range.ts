/**
 * Shared date-range presets for the account list pages.
 *
 * Both /account/bets and /account/transactions used to fetch the newest 100
 * rows with no way to narrow or page, so an older record was simply
 * unreachable. These presets are plain query params so the filtering happens in
 * the database and the result is linkable/shareable (a support agent can be
 * sent the exact URL).
 */

export const RANGE_PRESETS = [
  { id: "all", label: "All time" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
] as const;

export type RangeId = (typeof RANGE_PRESETS)[number]["id"];

export const PAGE_SIZE = 20;

export type RangeQuery = { range?: string; from?: string; to?: string; page?: string };

/** Prisma `gte`/`lt` pair for a preset, or an explicit from/to override. */
export function dateWindow(q: RangeQuery): { gte?: Date; lt?: Date } {
  const now = new Date();
  const explicitFrom = q.from ? new Date(q.from) : null;
  const explicitTo = q.to ? new Date(q.to) : null;
  // An explicit range always wins — it is what the operator typed.
  if (explicitFrom && !Number.isNaN(explicitFrom.getTime())) {
    const lt = explicitTo && !Number.isNaN(explicitTo.getTime())
      ? new Date(explicitTo.getTime() + 86_400_000) // inclusive end day
      : undefined;
    return { gte: explicitFrom, ...(lt ? { lt } : {}) };
  }
  const days = q.range === "7d" ? 7 : q.range === "30d" ? 30 : q.range === "90d" ? 90 : 0;
  if (!days) return {};
  return { gte: new Date(now.getTime() - days * 86_400_000) };
}

export function pageNumber(q: RangeQuery): number {
  const n = Number(q.page);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Build a URL preserving the other params. */
export function withParam(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) {
    if (v !== undefined && v !== "" && v !== "all" && !(k === "range" && v === "all")) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
