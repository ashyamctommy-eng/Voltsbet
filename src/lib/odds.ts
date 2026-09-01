export function fmtOdds(v: unknown): string {
  return Number(v).toFixed(2);
}

export function oddsFlashClass(v: number | string): string {
  void v;
  return "";
}

export function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatDateTime(d: Date, opts: { time?: boolean; date?: boolean } = {}) {
  const { time = true, date = true } = opts;
  const s = d.toLocaleString("en-GB", {
    day: date ? "2-digit" : undefined,
    month: date ? "short" : undefined,
    year: date && d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    hour: time ? "2-digit" : undefined,
    minute: time ? "2-digit" : undefined,
    hour12: false,
  });
  return s.replace(",", " ·");
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    OPEN: "text-green-400", ACTIVE: "text-green-400",
    LIVE: "text-red-500", SUSPENDED: "text-amber-400",
    WON: "text-green-400", LOST: "text-red-500",
    VOID: "text-gray-400", PENDING: "text-amber-400",
    PROCESSING: "text-blue-400", COMPLETED: "text-green-400",
    REJECTED: "text-red-500", CANCELLED: "text-gray-400", FAILED: "text-red-500",
    FINISHED: "text-green-400", SCHEDULED: "text-blue-400",
    SETTLED: "text-blue-400", CLOSED: "text-amber-400",
  };
  return map[status] ?? "text-gray-300";
}
