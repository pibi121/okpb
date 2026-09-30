/**
 * Deliver proactive TG messages to the bot the user last talked to.
 * Fallback: current OPS primary (BotInstance isPrimary) — never bare env alone
 * when a live primary token exists (env can lag behind dual-bot rotation).
 */
import { prisma } from "@/lib/db";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import {
  resolveBotTokenByInstanceId,
  resolvePrimaryLiveBot,
} from "@/lib/tg/bot-registry";

export async function resolveUserTelegramDelivery(userId: string): Promise<{
  chatId: number;
  token: string | undefined;
  platformUserId: string;
  botInstanceId: string | null;
} | null> {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    orderBy: { lastSeenAt: "desc" },
  });
  if (!acc?.platformUserId) return null;
  const chatId = Number(acc.platformUserId);
  if (!Number.isFinite(chatId)) return null;

  // 1) Bot they last used (if still active)
  if (acc.lastBotInstanceId) {
    const lastToken = await resolveBotTokenByInstanceId(acc.lastBotInstanceId);
    if (lastToken) {
      return {
        chatId,
        token: lastToken,
        platformUserId: acc.platformUserId,
        botInstanceId: acc.lastBotInstanceId,
      };
    }
  }

  // 2) Current OPS primary (dynamic — not hardcoded username / not stale env-only)
  const primary = await resolvePrimaryLiveBot();
  if (primary?.token) {
    return {
      chatId,
      token: primary.token,
      platformUserId: acc.platformUserId,
      botInstanceId: primary.id,
    };
  }

  return {
    chatId,
    token: undefined,
    platformUserId: acc.platformUserId,
    botInstanceId: null,
  };
}

/** Notify via last-used bot, else current primary. */
export async function tgNotifyUser(opts: {
  userId: string;
  text: string;
  extra?: Record<string, unknown>;
}): Promise<boolean> {
  const dest = await resolveUserTelegramDelivery(opts.userId);
  if (!dest?.token) return false;
  await tgSendMessage(dest.chatId, opts.text, opts.extra || {}, dest.token);
  return true;
}

/**
 * Fan-out: last bot first, then other live bots.
 * Default stops after first success; `allLive` sends on every live bot.
 */
export async function tgNotifyUserOnLiveBots(opts: {
  userId: string;
  text: string;
  extra?: Record<string, unknown>;
  allLive?: boolean;
}): Promise<number> {
  const dest = await resolveUserTelegramDelivery(opts.userId);
  if (!dest) return 0;

  const { listLiveBots } = await import("@/lib/tg/bot-registry");
  const live = await listLiveBots();
  const tokens: string[] = [];
  if (dest.token) tokens.push(dest.token);
  for (const b of live) {
    if (b.token && !tokens.includes(b.token)) tokens.push(b.token);
  }
  if (!tokens.length) return 0;

  let ok = 0;
  for (const token of tokens) {
    try {
      await tgSendMessage(dest.chatId, opts.text, opts.extra || {}, token);
      ok += 1;
      if (!opts.allLive) return ok;
    } catch {
      /* try next */
    }
  }
  return ok;
}
