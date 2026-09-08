import { prisma } from "@/lib/db";
import { tgSendMessage } from "@/lib/tg/telegram-api";

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

  await tgSendMessage(Number(acc.platformUserId), text);

  const row = await prisma.tgUserMessage.create({
    data: {
      userId: opts.userId,
      platformUserId: acc.platformUserId,
      direction: "outbound",
      text: text.slice(0, 4000),
      replyToId: opts.replyToId || null,
      readAt: new Date(),
      metaJson: JSON.stringify({ actorId: opts.actorId }),
    },
  });

  // Mark recent inbound as read
  await prisma.tgUserMessage.updateMany({
    where: {
      userId: opts.userId,
      direction: "inbound",
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  return row;
}
