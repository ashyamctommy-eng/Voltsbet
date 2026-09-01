import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { handle, ok, ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { consumeTelegramLinkToken, sendTelegramMessage, escapeHtml } from "@/lib/telegram";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Telegram Bot webhook — receives updates for the UNIBET360 bot.
 *
 * Handled commands:
 *   /start <LINK_TOKEN>  → deep-link account binding (token minted in
 *                          Account → Settings → Telegram)
 *   /start               → greeting + linking instructions
 *
 * OTP delivery is OUTBOUND only (direct Bot API `sendMessage` from
 * lib/telegram.ts) — this webhook never returns codes in replies.
 *
 * Register with:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d url="https://<host>/api/webhooks/telegram" \
 *     -d secret_token="<telegram.webhookSecret>"
 */

type TgMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
};

type TgUpdate = { update_id: number; message?: TgMessage };

function secretOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST = handle(async (req: NextRequest) => {
  const settings = await getSettings();

  // Webhook authentication — Telegram echoes secret_token in this header.
  const expected = settings.telegramWebhookSecret;
  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !secretOk(provided, expected)) {
    throw new ApiError(401, "Invalid webhook secret.", "BAD_WEBHOOK_SECRET");
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  if (!msg?.text || msg.chat.type !== "private") return ok({ ignored: true });

  // Basic flood control per chat
  const rl = rateLimit(`tg:${msg.chat.id}`, 20, 60_000);
  if (!rl.ok) return ok({ ignored: true });

  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    const token = text.slice("/start".length).trim();
    if (!token) {
      await sendTelegramMessage(
        msg.chat.id,
        `👋 Welcome to the <b>UNIBET360</b> bot!\n\nTo link your account, open UNIBET360 → Account → Settings → Telegram and tap <b>Link Telegram</b> — that button carries your personal link token.`
      );
      return ok({ handled: "start" });
    }

    const linked = await consumeTelegramLinkToken(token, {
      id: msg.chat.id,
      username: msg.from?.username,
    });
    if (!linked) {
      await sendTelegramMessage(
        msg.chat.id,
        `⚠️ That link is invalid or expired. Generate a fresh one in UNIBET360 → Account → Settings → Telegram.`
      );
      return ok({ handled: "link_failed" });
    }
    await sendTelegramMessage(
      msg.chat.id,
      `✅ Linked to <b>${escapeHtml(linked.username)}</b>. Verification codes will arrive here. You can unlink any time in Account → Settings.`
    );
    return ok({ handled: "linked" });
  }

  if (text.startsWith("/help")) {
    await sendTelegramMessage(
      msg.chat.id,
      `I deliver UNIBET360 verification codes. There's nothing to type here — codes arrive automatically when you log in.`
    );
    return ok({ handled: "help" });
  }

  return ok({ ignored: true });
});
