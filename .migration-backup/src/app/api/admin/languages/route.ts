import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "languages");
  const languages = await prisma.language.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ languages });
});

const langSchema = z.object({
  code: z.string().min(2).max(5).transform((s) => s.toLowerCase()),
  name: z.string().min(1),
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "languages");
  const body = await req.json().catch(() => null);
  const parsed = langSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const exists = await prisma.language.findUnique({ where: { code: parsed.data.code } });
  if (exists) throw new ApiError(409, "Language exists.", "EXISTS");
  const lang = await prisma.language.create({ data: parsed.data });
  await auditLog({ admin, action: "CREATE", entity: "LANGUAGE", entityId: parsed.data.code });
  return ok({ language: lang });
});

// ── Translations ──────────────────────────────────────────────
export const PATCH = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "languages");
  const body = await req.json().catch(() => null);
  const { langCode, translations } = body ?? {};
  if (!langCode || !Array.isArray(translations)) throw new ApiError(400, "langCode + translations[] required.", "BAD_BODY");
  const lang = await prisma.language.findUnique({ where: { code: langCode } });
  if (!lang) throw new ApiError(404, "Language not found.", "NOT_FOUND");

  let count = 0;
  for (const t of translations) {
    if (!t?.key || t?.value === undefined) continue;
    await prisma.translation.upsert({
      where: { langCode_key: { langCode, key: String(t.key) } },
      update: { value: String(t.value) },
      create: { langCode, key: String(t.key), value: String(t.value) },
    });
    count++;
  }
  await auditLog({ admin, action: "TRANSLATION_UPDATE", entity: "LANGUAGE", entityId: langCode, newValue: { count } });
  return ok({ message: `${count} translations saved` });
});
