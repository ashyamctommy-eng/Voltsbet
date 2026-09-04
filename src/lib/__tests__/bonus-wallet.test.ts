import { describe, it, expect } from "vitest";
import { availableBankroll, splitStakeFunds, toCents } from "../wallet";

describe("bonus-balance bankroll rules", () => {
  it("rounds to cents", () => {
    expect(toCents(1.005)).toBe(1.0);
    expect(toCents(10.999)).toBe(11.0);
  });

  it("excludes the bonus from the bankroll while it is locked (no first deposit)", () => {
    expect(availableBankroll(100, 4000, false)).toBe(100);
    expect(splitStakeFunds(100, 4000, 150, false)).toEqual({ fromBalance: 150, fromBonus: 0 });
    // locked bonus + insufficient real balance
    expect(splitStakeFunds(50, 4000, 150, false)).toEqual({ fromBalance: 150, fromBonus: 0 });
  });

  it("includes the bonus once unlocked by the first deposit", () => {
    expect(availableBankroll(100, 4000, true)).toBe(4100);
  });

  it("funds stakes bonus-first when unlocked", () => {
    // stake fully covered by bonus
    expect(splitStakeFunds(100, 4000, 500, true)).toEqual({ fromBonus: 500, fromBalance: 0 });
    // stake larger than bonus → bonus drained, remainder from balance
    expect(splitStakeFunds(100, 4000, 4500, true)).toEqual({ fromBonus: 4000, fromBalance: 500 });
    // exact boundary
    expect(splitStakeFunds(0, 4000, 4000, true)).toEqual({ fromBonus: 4000, fromBalance: 0 });
    // zero bonus behaves like a plain balance wallet
    expect(splitStakeFunds(250, 0, 100, true)).toEqual({ fromBonus: 0, fromBalance: 100 });
  });

  it("never splits fractions or negative amounts", () => {
    expect(splitStakeFunds(10, 4000, -5, true)).toEqual({ fromBonus: 0, fromBalance: 0 });
    expect(splitStakeFunds(10.005, 5.005, 8.009, true)).toEqual({ fromBonus: 5.01, fromBalance: 3.0 });
  });
});
