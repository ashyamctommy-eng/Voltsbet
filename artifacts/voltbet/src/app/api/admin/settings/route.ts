import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";

/**
 * Secret settings are masked on read: the raw value never leaves the server
 * for GET (an admin panel leak or shoulder-surf can't expose provider keys).
 * When a masked value comes back on PUT it is ignored, so saving the form
 * preserves the stored secret. Typing a new value replaces it.
 */
const SECRET_SETTINGS = new Set([
  "crypto.apiKey",
  "crypto.ipnSecret",
  "crypto.payoutApiKey",
  "mpesa.consumerSecret",
  "mpesa.passkey",
  "mpesa.securityCredential",
  "mpesa.callbackSecret",
  "palplus.apiKey",
  "palplus.webhookSecret",
  "telegram.botToken",
  "telegram.webhookSecret",
]);
const MASK = "__MASKED__";

function isSecret(key: string) {
  return SECRET_SETTINGS.has(key);
}

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return ok({
    settings: Object.fromEntries(
      settings.map((s) => [s.key, s.value && isSecret(s.key) ? MASK : s.value])
    ),
  });
});

export const PUT = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "settings");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Send a settings object.", "BAD_BODY");
  }
  const prev: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") {
      throw new ApiError(400, `Setting ${key} must be a string value.`, "BAD_VALUE");
    }
    // Masked sentinel = "unchanged" — keep whatever is stored.
    if (isSecret(key) && value === MASK) continue;
    const old = await prisma.setting.findUnique({ where: { key } });
    prev[key] = old?.value ?? "";
    await setSetting(key, value);
  }
  invalidateSettingsCache();
  await auditLog({ admin, action: "UPDATE", entity: "SETTINGS", prevValue: prev, newValue: body });
  return ok({ message: "Settings saved" });
});
