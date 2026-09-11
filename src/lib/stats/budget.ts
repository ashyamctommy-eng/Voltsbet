/**
 * Daily request budget for the settlement stats feed (API-Football free tier =
 * 100/day). Stored in `Setting` so no schema migration is needed:
 *
 *   stats.budgetDate = "2026-09-10"   (UTC day the counter belongs to)
 *   stats.budgetUsed = "12"           (requests consumed that day)
 *
 * The guard is deliberately conservative: when the budget is spent we REFUSE the
 * call and let the match fall back to the manual review queue (never an error in
 * the settlement path).
 */
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

const DATE_KEY = "stats.budgetDate";
const USED_KEY = "stats.budgetUsed";

/** UTC day key — the free plan resets at 00:00 UTC. */
export function budgetDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Pure decision: may we spend `n` requests when `used` are already spent? */
export function budgetAllows(used: number, budget: number, n = 1): boolean {
  if (!Number.isFinite(budget) || budget <= 0) return false; // 0 = disabled
  return used + n <= budget;
}

/** Pure decision: does the stored counter belong to a previous day? */
export function budgetNeedsReset(storedDate: string | null | undefined, today: string): boolean {
  return !!storedDate && storedDate !== today;
}

export type StatsBudget = { date: string; used: number; budget: number; remaining: number };

async function readCounters(): Promise<{ date: string | null; used: number }> {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: [DATE_KEY, USED_KEY] } } });
    const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
    const used = Number(get(USED_KEY));
    return { date: get(DATE_KEY), used: Number.isFinite(used) ? used : 0 };
  } catch {
    return { date: null, used: 0 };
  }
}

async function writeCounter(key: string, value: string): Promise<void> {
  try {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  } catch {
    /* counters are an optimisation — never break a settlement path */
  }
}

export async function statsBudget(now: Date = new Date()): Promise<StatsBudget> {
  const s = await getSettings();
  const today = budgetDateKey(now);
  const { date, used } = await readCounters();
  const effectiveUsed = budgetNeedsReset(date, today) ? 0 : used;
  const budget = s.statsDailyBudget;
  return { date: today, used: effectiveUsed, budget, remaining: Math.max(0, budget - effectiveUsed) };
}

/**
 * Spend `n` requests if the budget allows. Returns `allowed: false` (without
 * erroring) when the day's budget is spent — the caller skips the fetch.
 */
export async function consumeStatsBudget(n = 1, now: Date = new Date()): Promise<{ allowed: boolean; used: number; budget: number }> {
  const s = await getSettings();
  const today = budgetDateKey(now);
  const { date, used } = await readCounters();
  const current = budgetNeedsReset(date, today) ? 0 : used;

  if (!budgetAllows(current, s.statsDailyBudget, n)) {
    return { allowed: false, used: current, budget: s.statsDailyBudget };
  }
  const next = current + n;
  if (budgetNeedsReset(date, today)) await writeCounter(DATE_KEY, today);
  await writeCounter(USED_KEY, String(next));
  return { allowed: true, used: next, budget: s.statsDailyBudget };
}
