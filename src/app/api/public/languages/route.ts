import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Public: enabled languages for the navbar selector (admin-managed). */
export const GET = handle(async () => {
  const languages = await prisma.language.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return ok({ languages: languages.map((l) => ({ code: l.code, name: l.name, isDefault: l.isDefault })) });
});
