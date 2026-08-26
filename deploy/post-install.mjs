/**
 * VoltBet post-install helper — run by deploy/install.sh after the seed.
 * Sets per-client branding (site name + primary color) and resets the
 * admin password, all via the DB (so each client's install is independent).
 *
 * Usage (needs DATABASE_URL in env):
 *   node deploy/post-install.mjs <siteName> <brandColor> <adminEmail> <newAdminPassword>
 *
 * Also usable standalone for support calls:
 *   DATABASE_URL=... node deploy/post-install.mjs "MyBet" "#00c853" admin@voltbet.test 'NewPass123!'
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , siteName, brandColor, adminEmail, newPassword] = process.argv;
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
    const hash = await bcrypt.hash(newPassword, 10);
    const user = await p.user.update({ where: { email: adminEmail }, data: { passwordHash: hash } });
    console.log(`admin password updated for ${user.email}`);
  }
} finally {
  await p.$disconnect();
}
