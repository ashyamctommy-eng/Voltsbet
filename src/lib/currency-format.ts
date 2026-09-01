/**
 * Centralized Intl-based currency formatter.
 *
 * Handles ANY ISO 4217 code (incl. RON, SRD) via Intl.NumberFormat, with a
 * plain `CODE 1,234.56` fallback for unknown codes or non-finite amounts —
 * never throws.
 */
export function formatCurrency(amount: number, currencyCode = "KES"): string {
  const n = Number(amount);
  if (!isFinite(n)) return `${currencyCode} 0.00`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currencyCode} ${n.toFixed(2)}`;
  }
}

/** Format a raw number WITHOUT a symbol (stake input friendly). */
export function formatNumber(amount: number, maximumFractionDigits = 2): string {
  const n = Number(amount);
  if (!isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
  });
}
