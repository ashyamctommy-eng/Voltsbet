import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";

export const GET = handle(async () => {
  await requireAdmin("settings");
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return ok({ settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
});

export const PUT = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("settings");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Send a settings object.", "BAD_BODY");
  }
  const prev: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") {
      throw new ApiError(400, `Setting ${key} must be a string value.`, "BAD_VALUE");
    }
    const old = await prisma.setting.findUnique({ where: { key } });
    prev[key] = old?.value ?? "";
    await setSetting(key, value);
  }
  invalidateSettingsCache();
  await auditLog({ admin, action: "UPDATE", entity: "SETTINGS", prevValue: prev, newValue: body });
  return ok({ message: "Settings saved" });
});
