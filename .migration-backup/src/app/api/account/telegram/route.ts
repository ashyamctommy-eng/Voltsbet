import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { createTelegramLink } from "@/lib/telegram";

/**
 * Telegram account linking (user-facing):
 *   GET    → link status + whether the bot/OTP feature is configured
 *   POST   → mint a single-use deep link (t.me/<bot>?start=<token>)
 *   DELETE → unlink
 */
export const GET = handle(async () => {
  const user = await requireUser();
  const settings = await getSettings();
  return ok({
    linked: !!user.telegramChatId,
    username: user.telegramUsername,
    linkedAt: user.telegramLinkedAt,
    botUsername: settings.telegramBotUsername || null,
    otpEnabled: settings.telegramOtpEnabled,
  });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const link = await createTelegramLink(user.id);
  return ok({ url: link.url, expiresAt: link.expiresAt });
});

export const DELETE = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  if (!user.telegramChatId) throw new ApiError(400, "No Telegram account is linked.", "NOT_LINKED");
  await prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
  });
  return ok({ linked: false, message: "Telegram unlinked." });
});
