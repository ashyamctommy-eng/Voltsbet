/**
 * VoltBet post-install helper — run by installer.sh (root) / deploy/install.sh
 * after the seed. Sets per-client branding, the initial Super Admin
 * credentials, and optional Telegram bot settings, all via the DB (so each
 * client's install is independent).
 *
 * Usage (needs DATABASE_URL in env):
 *   node deploy/post-install.mjs <siteName> <brandColor> <adminEmail> <newAdminPassword> [adminUsername]
 *
 * Branding (optional):
 *   BRAND_ACCENT=#7c3aed — second brand hue; promo banners, badges and
 *   secondary highlights read it as --vb-accent. Without it the seed
 *   default (#7c3aed) is kept.
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
  if (process.env.BRAND_ACCENT) {
    const accent = process.env.BRAND_ACCENT.trim();
    await upsertSetting("branding.accentColor", accent);
    console.log(`branding: branding.accentColor = ${accent}`);
  }

  // ── Rebrand the vendor's name out of the seeded content ──────────────
  // prisma/seed.ts ships a few user-visible strings with the VENDOR's brand in
  // them ("Welcome to Voltbets", the support WhatsApp greeting). On a
  // white-label install those are the first thing a client's customers see, so
  // rewrite them here — this is the only step that knows the client's name.
  if (siteName) {
    const VENDOR = ["Voltbets", "VoltBet"];
    const rebrand = (s) => VENDOR.reduce((acc, v) => acc.split(v).join(siteName), s);
    let touched = 0;
    for (const b of await p.banner.findMany()) {
      const title = rebrand(b.title ?? "");
      const description = b.description == null ? b.description : rebrand(b.description);
      if (title !== b.title || description !== b.description) {
        await p.banner.update({ where: { id: b.id }, data: { title, description } });
        touched++;
      }
    }
    for (const s of await p.setting.findMany()) {
      const value = rebrand(s.value ?? "");
      if (value !== s.value) {
        await p.setting.update({ where: { key: s.key }, data: { value } });
        touched++;
      }
    }
    console.log(`rebrand: ${touched} seeded string(s) now say "${siteName}"`);
  }

  // The seed's support address is a .test placeholder — useless on a live site.
  // The installer knows the real domain, so use it when it was never customised.
  const siteDomain = (process.env.SITE_DOMAIN ?? "").trim();
  if (siteDomain) {
    const email = await p.setting.findUnique({ where: { key: "support.email" } });
    if (!email || /@(voltbets|voltbet)\.test$/i.test(email.value) || !email.value.trim()) {
      await upsertSetting("support.email", `support@${siteDomain}`);
      console.log(`branding: support.email = support@${siteDomain}`);
    }
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
