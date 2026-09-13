import { describe, expect, it, afterEach } from "vitest";
import { activeEnvOverrides } from "@/lib/settings-env";

const KEYS = ["MAINTENANCE_MODE", "SHOW_SEEDED_GAMES", "BETSLIP_AUTO_OPEN", "ENABLE_MPESA_PAYMENTS", "ENABLE_MPESA_WITHDRAWALS"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe("activeEnvOverrides", () => {
  it("reports nothing when no env var is set", () => {
    expect(activeEnvOverrides()).toEqual({});
  });

  it("does NOT claim an override for MAINTENANCE_MODE=0", () => {
    // Set-but-not-forcing: a presence-only check would badge this as overridden.
    process.env.MAINTENANCE_MODE = "0";
    expect(activeEnvOverrides()["maintenance.enabled"]).toBeUndefined();
    process.env.MAINTENANCE_MODE = "1";
    expect(activeEnvOverrides()["maintenance.enabled"]?.effect).toMatch(/forces the maintenance screen ON/);
  });

  it("explains the inverted SHOW_SEEDED_GAMES rather than echoing it", () => {
    process.env.SHOW_SEEDED_GAMES = "false";
    expect(activeEnvOverrides()["games.hideSeeded"]?.effect).toMatch(/hides seeded/);
    process.env.SHOW_SEEDED_GAMES = "true";
    expect(activeEnvOverrides()["games.hideSeeded"]?.effect).toMatch(/shows seeded/);
  });

  it("maps each supported setting to its env var and reports the raw value", () => {
    process.env.ENABLE_MPESA_PAYMENTS = "false";
    const o = activeEnvOverrides();
    expect(o["mpesa.enabled"]).toMatchObject({ env: "ENABLE_MPESA_PAYMENTS", value: "false" });
    expect(o["mpesa.enabled"].effect).toMatch(/forces M-Pesa payments OFF/);
  });
});
