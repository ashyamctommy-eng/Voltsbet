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

/**
 * Local calendar-day window [00:00:00, 23:59:59.999] for a date option value.
 *
 * DST-safe: never assumes a day is 24h. The next local midnight is built via
 * the Date constructor (`new Date(y, m, d + 1)`), which normalizes across the
 * 23h/25h DST transition days automatically.
 */
export function dayWindow(value: string): { from: number; to: number } {
  const d = new Date(value); // "Wed Aug 19 2026" parses as local midnight
  if (Number.isNaN(d.getTime())) return { from: 0, to: 0 };
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { from: d.getTime(), to: next.getTime() };
}

/**
 * Parse a URL `?date=YYYY-MM-DD` param into a local-midnight option value
 * ("Wed Aug 19 2026"). Never `new Date("YYYY-MM-DD")` — that parses as UTC
 * midnight and shifts the whole day in non-UTC timezones (and differently
 * around DST transitions).
 */
export function dateParamToValue(param: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(param ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}

/** Convert an option value back to a `YYYY-MM-DD` URL param. */
export function valueToDateParam(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
