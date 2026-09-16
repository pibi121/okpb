import { prisma } from "@/lib/db";
import { tgSendMessage } from "@/lib/tg/telegram-api";

export type InboxDirection = "inbound" | "outbound" | "system";

export async function recordInboundUserMessage(opts: {
  userId: string;
  platformUserId: string;
  text: string;
  meta?: Record<string, unknown>;
}) {
  const text = opts.text.trim();
  if (!text) return null;
  return prisma.tgUserMessage.create({
    data: {
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      direction: "inbound",
      text: text.slice(0, 4000),
      metaJson: JSON.stringify(opts.meta || {}),
    },
  });
}

export async function recordOutboundBotMessage(opts: {
  userId: string;
  platformUserId: string;
  text: string;
  meta?: Record<string, unknown>;
  /** Ops replies mark inbound as read */
  markInboundRead?: boolean;
  replyToId?: string | null;
}) {
  const text = opts.text.trim();
  if (!text) return null;
  const row = await prisma.tgUserMessage.create({
    data: {
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      direction: "outbound",
      text: text.slice(0, 4000),
      readAt: new Date(),
      replyToId: opts.replyToId || null,
      metaJson: JSON.stringify({ source: "bot", ...(opts.meta || {}) }),
    },
  });
  if (opts.markInboundRead) {
    await prisma.tgUserMessage.updateMany({
      where: {
        userId: opts.userId,
        direction: "inbound",
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }
  return row;
}

/**
 * Formerly wrote balance moves into the ops message thread.
 * Inbox is human↔ops only now — kept as a no-op for existing callers.
 */
export async function recordSystemBalanceNotice(_opts: {
  userId: string;
  amount: number;
  reason: string;
  meta?: Record<string, unknown>;
}) {
  return null;
}

/** Prisma where: user free-text + manual ops replies (not auto bot / system). */
export const inboxHumanThreadWhere = {
  OR: [
    { direction: "inbound" as const },
    {
      AND: [
        { direction: "outbound" as const },
        { metaJson: { contains: '"source":"ops"' } },
      ],
    },
  ],
};

export function peachReasonLabel(reason: string): string {
  const r = reason.toLowerCase();
  if (/refund|возврат/.test(r)) return "возврат 🍑";
  if (/topup|payment|начисл|paid/.test(r)) return "пополнение";
  if (/lora_train|tg_lora_train/.test(r) && !/refund/.test(r))
    return "обучение LoRA";
  if (/photo|gen_photo|still/.test(r)) return "генерация фото";
  if (/video|i2v|clip|quick/.test(r)) return "генерация видео";
  if (/partner|commission/.test(r)) return "партнёрка";
  if (/bonus|welcome|promo/.test(r)) return "бонус";
  return reason.slice(0, 80) || "движение баланса";
}

/** Resolve TG chat id → user and record outbound (fire-and-forget safe). */
export async function recordOutboundFromChatId(
  chatId: number | string,
  text: string,
  meta?: Record<string, unknown>,
) {
  const platformUserId = String(chatId);
  const acc = await prisma.platformAccount.findFirst({
    where: { platform: "telegram", platformUserId },
    select: { userId: true, platformUserId: true },
  });
  if (!acc) return null;
  return recordOutboundBotMessage({
    userId: acc.userId,
    platformUserId: acc.platformUserId,
    text,
    meta,
  });
}

export async function replyToUserFromOps(opts: {
  actorId: string;
  userId: string;
  text: string;
  replyToId?: string;
}) {
  const text = opts.text.trim();
  if (!text) throw new Error("Пустой ответ");

  const acc = await prisma.platformAccount.findFirst({
    where: { userId: opts.userId, platform: "telegram" },
    select: { platformUserId: true },
  });
  if (!acc) throw new Error("У пользователя нет Telegram");

  await tgSendMessage(Number(acc.platformUserId), text, {
    _peachSkipInbox: true,
  });

  return recordOutboundBotMessage({
    userId: opts.userId,
    platformUserId: acc.platformUserId,
    text,
    markInboundRead: true,
    replyToId: opts.replyToId || null,
    meta: {
      actorId: opts.actorId,
      source: "ops",
    },
  });
}
