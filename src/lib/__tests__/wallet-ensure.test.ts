import { describe, it, expect } from "vitest";
import { creditWallet, debitWallet } from "../wallet";

/**
 * Fake transaction client — enough surface for wallet.ts primitives:
 * wallets + ledger rows + user lookups. Confirms the self-healing behavior:
 * a user WITHOUT a Wallet row gets one minted instead of "Wallet not found".
 */
function makeDb() {
  const wallets = new Map<
    string,
    { userId: string; balance: number; bonusBalance: number; currencyCode: string }
  >();
  const ledger: Record<string, unknown>[] = [];
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "u1" ? { currencyCode: "KES" } : null,
    },
    wallet: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        const w = wallets.get(where.userId);
        return w ? { id: "w-" + w.userId, ...w } : null;
      },
      create: async ({
        data,
      }: {
        data: { userId: string; balance: string; bonusBalance: string; currencyCode: string };
      }) => {
        const w = {
          userId: data.userId,
          balance: Number(data.balance),
          bonusBalance: Number(data.bonusBalance),
          currencyCode: data.currencyCode,
        };
        wallets.set(data.userId, w);
        return { id: "w-" + data.userId, ...w };
      },
      update: async ({
        where,
        data,
      }: {
        where: { userId: string };
        data: { balance?: { increment: string }; bonusBalance?: { increment: string } };
      }) => {
        const w = wallets.get(where.userId);
        if (!w) throw new Error("no wallet");
        if (data.balance) w.balance += Number(data.balance.increment);
        if (data.bonusBalance) w.bonusBalance += Number(data.bonusBalance.increment);
        return { id: "w-" + w.userId, ...w };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId: string; balance: { gte: string } };
        data: { balance: { decrement: string } };
      }) => {
        const w = wallets.get(where.userId);
        if (!w) return { count: 0 };
        const amt = Number(data.balance.decrement);
        if (Number(w.balance) < Number(where.balance.gte)) return { count: 0 };
        w.balance -= amt;
        return { count: 1 };
      },
    },
    transaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        ledger.push(data);
        return { id: "t1", ...data };
      },
    },
  };
  return { wallets, ledger, tx };
}

describe("wallet self-healing (missing Wallet row)", () => {
  it("creditWallet mints a zero wallet for a legacy user and credits it", async () => {
    const { wallets, ledger, tx } = makeDb();

    const res = await creditWallet(tx as never, "u1", 500, {
      type: "DEPOSIT",
      method: "MPESA",
      reason: "STK confirm",
    });

    expect(res).toEqual({ prev: 0, next: 500 });
    const w = wallets.get("u1");
    expect(w).toBeDefined();
    expect(w?.balance).toBe(500);
    expect(w?.currencyCode).toBe("KES");
    // Ledger row recorded for the minted wallet's currency.
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: "500.00", currencyCode: "KES", newBalance: "500.00" });
  });

  it("debitWallet on a missing wallet mints it and fails with INSUFFICIENT_BALANCE (no silent overdraft)", async () => {
    const { wallets, tx } = makeDb();

    await expect(
      debitWallet(tx as never, "u1", 100, { type: "BET_STAKE", reason: "bet" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    // The wallet now exists (zero balance) so the NEXT funded deposit works.
    expect(wallets.has("u1")).toBe(true);
    expect(wallets.get("u1")?.balance).toBe(0);
  });

  it("unknown user id still errors instead of minting a wallet", async () => {
    const { wallets, tx } = makeDb();
    await expect(
      creditWallet(tx as never, "ghost", 10, { type: "DEPOSIT", reason: "x" }),
    ).rejects.toMatchObject({ code: "NO_USER" });
    expect(wallets.has("ghost")).toBe(false);
  });
});
