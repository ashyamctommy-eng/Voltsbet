/**
 * Kickoff timestamp formatting — relative strings in the USER'S local timezone:
 *   Same day  → "Today at 7:30 PM"
 *   Next day  → "Tomorrow at 1:00 AM"
 *   Later     → "Friday, August 21, 2026 at 7:00 PM"
 */

const TIME_FMT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, TIME_FMT).format(date);
}

export function formatKickoff(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86400_000);

  if (dayDiff === 0) return `Today at ${formatTime(d)}`;
  if (dayDiff === 1) return `Tomorrow at ${formatTime(d)}`;

  const full = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
  return `${full} at ${formatTime(d)}`;
}

/** Full absolute kickoff, e.g. "Friday, August 21, 2026 at 7:00 PM" (fixture page). */
export function formatKickoffFull(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const full = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
  return `${full} at ${formatTime(d)}`;
}

/** Short live-context label shown next to the LIVE badge, e.g. "19'", "Halftime HT", "4th set". */
export function liveContext(
  status: string,
  clock: string | null,
  period: string | null,
): string | null {
  if (status === "HALF_TIME" || period?.toLowerCase().includes("halftime")) return "Halftime HT";
  const setMatch = period?.match(/^Set\s*(\d+)$/i);
  if (setMatch) {
    const n = Number(setMatch[1]);
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suffix} set`;
  }
  if (clock) {
    const minute = clock.match(/^(\d{1,2}):\d{2}$/);
    if (minute) return `${Number(minute[1])}'`;
    if (clock.endsWith("'")) return clock;
    return clock;
  }
  return period ?? null;
}
