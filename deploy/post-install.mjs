/**
 * VoltBet post-install helper — run by installer.sh (root) / deploy/install.sh
 * after the seed. Sets per-client branding, the initial Super Admin
 * credentials, and optional Telegram bot settings, all via the DB (so each
 * client's install is independent).
 *
 * Usage (needs DATABASE_URL in env):
 *   node deploy/post-install.mjs <siteName> <brandColor> <adminEmail> <newAdminPassword> [adminUsername]
 *
 * Telegram settings via env (optional):
 *   TELEGRAM_BOT_TOKEN=…  TELEGRAM_BOT_USERNAME=… node deploy/post-install.mjs …
 *
 * Also usable standalone for support calls:
 *   DATABASE_URL=... node deploy/post-install.mjs "MyBet" "#00c853" admin@voltbet.test 'NewPass123!' admin
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , siteName, brandColor, adminEmail, newPassword, adminUsername] = process.argv;
const p = new PrismaClient();

async function upsertSetting(key, value) {
  if (!value) return;
  const existing = await p.setting.findUnique({ where: { key } });
  if (existing) await p.setting.update({ where: { key }, data: { value } });
  else await p.setting.create({ data: { key, value } });
}

try {
  if (siteName) {
    await upsertSetting("site.name", siteName);
    console.log(`branding: site.name = ${siteName}`);
  }
  if (brandColor) {
    await upsertSetting("branding.primaryColor", brandColor);
    console.log(`branding: branding.primaryColor = ${brandColor}`);
  }
  if (adminEmail && newPassword) {
    const hash = await bcrypt.hash(newPassword, 12);
    const username = adminUsername || adminEmail.split("@")[0];
    // Upsert — the seed may already have created this admin (fresh installs)
    // or this may be a brand-new account (custom email): either way the
    // result is one ACTIVE SUPER_ADMIN with the chosen credentials.
    const user = await p.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: hash, role: "SUPER_ADMIN", status: "ACTIVE" },
      create: {
        fullName: "Site Admin",
        username,
        email: adminEmail,
        phone: `+000${Date.now().toString().slice(-9)}`, // placeholder, unique
        passwordHash: hash,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        verified: true,
        wallet: { create: { balance: "0.00", currencyCode: "KES" } },
      },
    });
    console.log(`super-admin ready: ${user.email} (${user.role})`);
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    await upsertSetting("telegram.botToken", process.env.TELEGRAM_BOT_TOKEN);
    console.log("telegram: botToken stored");
  }
  if (process.env.TELEGRAM_BOT_USERNAME) {
    await upsertSetting("telegram.botUsername", process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, ""));
    console.log("telegram: botUsername stored");
  }
} finally {
  await p.$disconnect();
}
