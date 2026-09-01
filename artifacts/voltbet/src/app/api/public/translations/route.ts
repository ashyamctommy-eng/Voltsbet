import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Public translation lookup for a language. */
export const GET = handle(async (req: NextRequest) => {
  const lang = req.nextUrl.searchParams.get("lang") ?? "en";
  const translations = await prisma.translation.findMany({ where: { langCode: lang }, orderBy: { key: "asc" } });
  return ok({ translations: translations.map((t) => ({ key: t.key, value: t.value })) });
});
