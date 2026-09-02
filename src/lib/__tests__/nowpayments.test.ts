import { describe, it, expect } from "vitest";
import { npPayCurrency, NP_REQUIRED_NETWORK } from "@/lib/providers/nowpayments";

/**
 * pay_currency code mapping — money-safety relevant. NOWPayments has NO bare
 * code for USDT/BNB (verified live against /v1/currencies 2026-09-02), so the
 * network token must always resolve for those coins or deposits would target
 * a code the provider cannot route.
 */

describe("npPayCurrency", () => {
  it("qualifies USDT with TRC20 by default (no bare usdt code exists)", () => {
    expect(npPayCurrency("USDT")).toEqual({ code: "usdttrc20", network: "TRC20" });
    expect(npPayCurrency("USDT", "")).toEqual({ code: "usdttrc20", network: "TRC20" });
    expect(npPayCurrency("USDT", null)).toEqual({ code: "usdttrc20", network: "TRC20" });
  });

  it("qualifies BNB with BSC by default (no bare bnb code exists)", () => {
    expect(npPayCurrency("BNB")).toEqual({ code: "bnbbsc", network: "BSC" });
    expect(NP_REQUIRED_NETWORK.BNB).toBe("BSC");
  });

  it("honors an admin network override (USDT → BSC)", () => {
    expect(npPayCurrency("USDT", "BSC")).toEqual({ code: "usdtbsc", network: "BSC" });
  });

  it("uses the bare code for coins with a native code (BTC, ETH, USDC, TRX)", () => {
    expect(npPayCurrency("BTC")).toEqual({ code: "btc", network: null });
    expect(npPayCurrency("BTC", "BTC")).toEqual({ code: "btc", network: null }); // native pin collapses
    expect(npPayCurrency("ETH")).toEqual({ code: "eth", network: null });
    expect(npPayCurrency("USDC")).toEqual({ code: "usdc", network: null });
    expect(npPayCurrency("USDC", "SOL")).toEqual({ code: "usdcsol", network: "SOL" });
    expect(npPayCurrency("TRX")).toEqual({ code: "trx", network: null });
    expect(npPayCurrency("LTC")).toEqual({ code: "ltc", network: null });
    expect(npPayCurrency("SOL")).toEqual({ code: "sol", network: null });
  });

  it("normalizes case and whitespace", () => {
    expect(npPayCurrency("  usdt  ")).toEqual({ code: "usdttrc20", network: "TRC20" });
    expect(npPayCurrency("usdc", "base")).toEqual({ code: "usdcbase", network: "BASE" });
  });
});
