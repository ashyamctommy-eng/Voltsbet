/**
 * One-off backfill: create zero-balance wallets for any account that has
 * none — legacy users created before the Wallet model, direct DB inserts,
 * or imported accounts. They previously hit "Wallet not found" (NO_WALLET)
 * on their first deposit/withdrawal/bet.
 *
 * Since the app now self-heals (every money path mints a missing wallet via
 * ensureWallet in lib/wallet.ts), this script is optional — it just
 * normalizes the table immediately and lets audit queries pass cleanly.
 *
 * Run against the target database:
 *   DATABASE_URL="postgresql://..." pnpm tsx scripts/fix-missing-wallets.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { wallet: { is: null } },
    select: { id: true, username: true, email: true, currencyCode: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Users without a wallet: ${users.length}`);
  if (users.length === 0) {
    console.log("Nothing to do — every account already has a wallet ✅");
    return;
  }

  let created = 0;
  for (const u of users) {
    try {
      await prisma.wallet.create({
        data: { userId: u.id, balance: "0", bonusBalance: "0", currencyCode: u.currencyCode },
      });
      created++;
      console.log(`  + wallet (${u.currencyCode}) for ${u.username} <${u.email}>`);
    } catch (e) {
      // Unique-violation = a wallet appeared concurrently; skip quietly.
      const code = (e as { code?: string }).code;
      if (code === "P2002") {
        console.log(`  ~ wallet already exists for ${u.username} — skipped`);
        created++;
      } else {
        console.error(`  ! failed for ${u.username}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`Done — ${created}/${users.length} accounts now have wallets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
