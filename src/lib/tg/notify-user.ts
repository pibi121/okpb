/**
 * Send TG messages to a user via the bot they last used (dual-bot safe).
 */
import { prisma } from "@/lib/db";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { resolveBotTokenByInstanceId } from "@/lib/tg/bot-registry";

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
  const token =
    (await resolveBotTokenByInstanceId(acc.lastBotInstanceId)) || undefined;
  return {
    chatId,
    token,
    platformUserId: acc.platformUserId,
    botInstanceId: acc.lastBotInstanceId || null,
  };
}

/** Notify user; prefers last active bot instance token. */
export async function tgNotifyUser(opts: {
  userId: string;
  text: string;
  extra?: Record<string, unknown>;
}): Promise<boolean> {
  const dest = await resolveUserTelegramDelivery(opts.userId);
  if (!dest) return false;
  await tgSendMessage(dest.chatId, opts.text, opts.extra || {}, dest.token);
  return true;
}

/**
 * Fan-out to every active bot the user might still have open
 * (last bot first, then other live bots). Stops after first success
 * unless `allLive` is true.
 */
export async function tgNotifyUserOnLiveBots(opts: {
  userId: string;
  text: string;
  extra?: Record<string, unknown>;
  /** Send via every live bot (ops-critical notices). Default: last bot only. */
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
  if (!tokens.length) {
    // Fall back to env primary via tgSendMessage default
    await tgSendMessage(dest.chatId, opts.text, opts.extra || {});
    return 1;
  }

  let ok = 0;
  for (const token of tokens) {
    try {
      await tgSendMessage(dest.chatId, opts.text, opts.extra || {}, token);
      ok += 1;
      if (!opts.allLive) return ok;
    } catch {
      /* try next bot */
    }
  }
  return ok;
}
