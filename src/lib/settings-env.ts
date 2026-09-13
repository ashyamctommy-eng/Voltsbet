/**
 * Which settings an environment variable silently overrides.
 *
 * This exists because of a real support thread: the "Catalog-mode league cap"
 * looked stuck at 120 and the cause was an env var winning over the DB value,
 * with nothing in the UI saying so. A field that cannot be changed from the
 * panel must say that where the admin is looking.
 *
 * `active` decides whether the value actually takes effect — MAINTENANCE_MODE=0
 * is set but does NOT force maintenance on, so a presence-only check would show
 * a misleading badge.
 */

export type EnvOverride = { env: string; value: string; effect: string };

const TRUTHY = (v: string) => v === "1" || v === "true";

const MAP: Record<string, { env: string; effect: (v: string) => string; active?: (v: string) => boolean }> = {
  "maintenance.enabled": {
    env: "MAINTENANCE_MODE",
    active: TRUTHY,
    effect: () => "forces the maintenance screen ON (and keeps working when the database is down)",
  },
  "games.hideSeeded": {
    env: "SHOW_SEEDED_GAMES",
    effect: (v) => (v === "true" ? "shows seeded/demo games (overrides the toggle)" : "hides seeded/demo games (overrides the toggle)"),
  },
  "betSlip.autoOpen": {
    env: "BETSLIP_AUTO_OPEN",
    effect: (v) => (TRUTHY(v) ? "forces the bet slip to auto-open" : "forces the bet slip to stay closed"),
  },
  "mpesa.enabled": {
    env: "ENABLE_MPESA_PAYMENTS",
    effect: (v) => (TRUTHY(v) ? "forces M-Pesa payments ON" : "forces M-Pesa payments OFF"),
  },
  "payments.mpesaWithdrawalsEnabled": {
    env: "ENABLE_MPESA_WITHDRAWALS",
    effect: (v) => (TRUTHY(v) ? "forces M-Pesa withdrawals ON" : "forces M-Pesa withdrawals OFF"),
  },
};

/** Setting key → override, for every env var currently in effect. */
export function activeEnvOverrides(): Record<string, EnvOverride> {
  const out: Record<string, EnvOverride> = {};
  for (const [key, cfg] of Object.entries(MAP)) {
    const raw = process.env[cfg.env];
    if (raw === undefined) continue;
    if (cfg.active && !cfg.active(raw)) continue;
    out[key] = { env: cfg.env, value: raw, effect: cfg.effect(raw) };
  }
  return out;
}
