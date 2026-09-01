import { createHash, randomBytes, randomInt } from "crypto";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { ApiError } from "./api";

/**
 * Telegram integration — Bot API client + OTP store + account-link tokens.
 *
 * This REPLACES TOTP 2FA: one-time passcodes are delivered straight to the
 * user's Telegram DM via the Bot API `sendMessage` method (no third-party
 * OTP provider in the loop). Setup:
 *   1. @BotFather → create bot → put the token in Admin → Settings
 *      (`telegram.botToken`) and the bot username in `telegram.botUsername`.
 *   2. Point a webhook at /api/webhooks/telegram with
 *      secret_token = `telegram.webhookSecret` so the bot can answer
 *      /start <LINK_TOKEN> deep links.
 *   3. Flip `telegram.otpEnabled` to require a Telegram OTP at login for
 *      every linked account.
 */

const API_BASE = "https://api.telegram.org";

const OTP_TTL_MS = 5 * 60_000; // code valid for 5 minutes
const OTP_MAX_ATTEMPTS = 5; // per code, then it's burned
const OTP_ISSUE_WINDOW_MS = 10 * 60_000; // rate-limit window…
const OTP_ISSUE_MAX = 3; // …max codes issued per user+purpose per window
const LINK_TOKEN_TTL_MS = 15 * 60_000;

export type OtpPurpose = "LOGIN" | "WITHDRAWAL" | string;

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** Escape user-supplied text for Telegram HTML parse mode. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Direct Bot API call. Throws ApiError on transport/API failure. */
export async function telegramApi<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const s = await getSettings();
  if (!s.telegramBotToken) {
    throw new ApiError(503, "Telegram bot is not configured (telegram.botToken).", "TELEGRAM_UNCONFIGURED");
  }
  const res = await fetch(`${API_BASE}/bot${s.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
  if (!res.ok || data.ok !== true) {
    throw new ApiError(502, `Telegram API error: ${data.description ?? res.statusText}`, "TELEGRAM_API_FAILED");
  }
  return data.result as T;
}

/** Send a DM to a linked Telegram chat. Returns false (not throw) when the bot is blocked. */
export async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  try {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    return true;
  } catch (e) {
    // 403 = user blocked the bot / chat gone — unlink happens lazily elsewhere
    if (e instanceof ApiError && e.message.includes("bot was blocked")) return false;
    if (e instanceof ApiError && e.message.includes("chat not found")) return false;
    throw e;
  }
}

// ─────────────────────────────── OTP store ───────────────────────────────

/**
 * Issue a 6-digit OTP for a user and deliver it to their linked Telegram.
 * Only the sha256 hash is persisted; any previous unconsumed code for the
 * same purpose is superseded (invalidated) so at most one code is live.
 */
export async function issueTelegramOtp(userId: string, purpose: OtpPurpose = "LOGIN"): Promise<{ sent: boolean; expiresAt: Date }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, username: true },
  });
  if (!user?.telegramChatId) {
    throw new ApiError(400, "No Telegram account linked. Link one in Account → Settings first.", "TELEGRAM_NOT_LINKED");
  }

  const since = new Date(Date.now() - OTP_ISSUE_WINDOW_MS);
  const recent = await prisma.otpCode.count({
    where: { userId, purpose, createdAt: { gte: since } },
  });
  if (recent >= OTP_ISSUE_MAX) {
    throw new ApiError(429, "Too many codes requested. Wait a few minutes and try again.", "OTP_RATE_LIMITED");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.$transaction([
    // Supersede any live code for this purpose
    prisma.otpCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.otpCode.create({
      data: { userId, purpose, codeHash: sha256(code), expiresAt },
    }),
  ]);

  const sent = await sendTelegramMessage(
    user.telegramChatId,
    `🔐 <b>UNIBET360 verification code</b>\n\n<code>${code}</code>\n\nValid for 5 minutes. If you didn't request this, ignore it and change your password.`
  );
  if (!sent) {
    throw new ApiError(502, "Could not reach Telegram — open the bot chat and press Start, then retry.", "TELEGRAM_UNREACHABLE");
  }
  return { sent, expiresAt };
}

/**
 * Verify a code. Constant-shape failure: expired, exhausted, wrong and
 * missing codes all raise the same 401 so callers can't enumerate state.
 */
export async function verifyTelegramOtp(userId: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const live = await prisma.otpCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!live) return false;
  if (live.expiresAt < new Date() || live.attempts >= OTP_MAX_ATTEMPTS) return false;

  const matches = live.codeHash === sha256(code);
  if (!matches) {
    const attempts = live.attempts + 1;
    await prisma.otpCode.update({
      where: { id: live.id },
      // Burn the code at the attempt cap — no unlimited guessing
      data: { attempts, ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
    });
    return false;
  }

  await prisma.otpCode.update({ where: { id: live.id }, data: { consumedAt: new Date() } });
  return true;
}

// ─────────────────────────── Account linking ─────────────────────────────

/** Mint a single-use deep-link token and return the t.me URL for the bot. */
export async function createTelegramLink(userId: string): Promise<{ url: string; token: string; expiresAt: Date }> {
  const s = await getSettings();
  if (!s.telegramBotUsername) {
    throw new ApiError(503, "Telegram bot is not configured (telegram.botUsername).", "TELEGRAM_UNCONFIGURED");
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
  // One outstanding link token per user — old ones are voided
  await prisma.telegramLinkToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.telegramLinkToken.create({ data: { token, userId, expiresAt } });
  return { url: `https://t.me/${s.telegramBotUsername}?start=${token}`, token, expiresAt };
}

/**
 * Consume a `/start <token>` deep link: binds the Telegram chat to the user.
 * Returns the user on success, null on invalid/expired/used token.
 */
export async function consumeTelegramLinkToken(
  token: string,
  chat: { id: number | string; username?: string }
): Promise<{ userId: string; username: string } | null> {
  const row = await prisma.telegramLinkToken.findUnique({ where: { token } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;

  const chatId = String(chat.id);
  // A chat can only be bound to one account — steal attempts detach the old one
  await prisma.user.updateMany({
    where: { telegramChatId: chatId, id: { not: row.userId } },
    data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
  });
  const user = await prisma.user.update({
    where: { id: row.userId },
    data: {
      telegramChatId: chatId,
      telegramUsername: chat.username ?? null,
      telegramLinkedAt: new Date(),
    },
    select: { id: true, username: true },
  });
  await prisma.telegramLinkToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return { userId: user.id, username: user.username };
}
