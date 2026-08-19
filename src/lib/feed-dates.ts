/**
 * Rolling 7-day date selector helpers (client-safe, pure).
 *
 * Option structure:
 *   Day 0: "Today"    | "Aug 19"
 *   Day 1: "Tomorrow" | "Aug 20"
 *   Day 2–6: "Friday" | "Aug 21"
 *
 * Filtering: a selected value maps to the local calendar day window
 * [00:00:00, 23:59:59.999].
 */

export type DateOption = {
  /** Stable key — local-midnight Date#toDateString() (e.g. "Wed Aug 19 2026"). */
  value: string;
  /** Day label: "Today" / "Tomorrow" / weekday name. */
  label: string;
  /** Abbreviated date, e.g. "Aug 19". */
  dateLabel: string;
};

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Build the rolling 7-day array starting from today (local time). */
export function buildDateOptions(now: Date = new Date()): DateOption[] {
  const opts: DateOption[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    opts.push({
      value: d.toDateString(),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAY_FMT.format(d),
      dateLabel: SHORT_DATE_FMT.format(d),
    });
  }
  return opts;
}

/** Local calendar-day window [00:00:00, 23:59:59.999] for a date option value. */
export function dayWindow(value: string): { from: number; to: number } {
  const d = new Date(value); // "Wed Aug 19 2026" parses as local midnight
  const from = Number.isNaN(d.getTime()) ? 0 : d.getTime();
  return { from, to: from + 86400_000 };
}
