import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { replyToUserFromOps } from "@/lib/ops/inbox";
import { writeAudit } from "@/lib/ops/audit";

export async function GET(req: Request) {
  return withOps("inbox", async () => {
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId") || "";

    if (userId) {
      const messages = await prisma.tgUserMessage.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      await prisma.tgUserMessage.updateMany({
        where: { userId, direction: "inbound", readAt: null },
        data: { readAt: new Date() },
      });
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          locale: true,
          balancePeaches: true,
          platformAccounts: {
            where: { platform: "telegram" },
            select: { platformUserId: true },
            take: 1,
          },
        },
      });
      return jsonOk({
        user: user
          ? {
              ...user,
              tgId: user.platformAccounts[0]?.platformUserId || "",
            }
          : null,
        messages: messages.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          readAt: m.readAt?.toISOString() || null,
        })),
      });
    }

    // Thread list: latest inbound per user
    const recent = await prisma.tgUserMessage.findMany({
      where: { direction: "inbound" },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        userId: true,
        platformUserId: true,
        text: true,
        createdAt: true,
        readAt: true,
        user: { select: { name: true, locale: true } },
      },
    });

    const seen = new Set<string>();
    const threads: Array<{
      userId: string;
      tgId: string;
      name: string | null;
      locale: string;
      lastText: string;
      lastAt: string;
      unread: boolean;
    }> = [];

    for (const m of recent) {
      if (seen.has(m.userId)) continue;
      seen.add(m.userId);
      const unreadCount = await prisma.tgUserMessage.count({
        where: { userId: m.userId, direction: "inbound", readAt: null },
      });
      threads.push({
        userId: m.userId,
        tgId: m.platformUserId,
        name: m.user.name,
        locale: m.user.locale,
        lastText: m.text.slice(0, 160),
        lastAt: m.createdAt.toISOString(),
        unread: unreadCount > 0,
      });
    }

    const unreadTotal = await prisma.tgUserMessage.count({
      where: { direction: "inbound", readAt: null },
    });

    return jsonOk({ threads, unreadTotal });
  });
}

export async function POST(req: Request) {
  return withOps("inbox", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      userId?: string;
      text?: string;
      replyToId?: string;
    };
    if (body.action === "reply") {
      if (!body.userId || !(body.text || "").trim()) {
        return jsonErr("Нужны userId и текст");
      }
      const row = await replyToUserFromOps({
        actorId: actor.id,
        userId: body.userId,
        text: body.text!,
        replyToId: body.replyToId,
      });
      await writeAudit({
        actorId: actor.id,
        action: "inbox_reply",
        targetType: "user",
        targetId: body.userId,
        detail: { messageId: row.id },
      });
      return jsonOk({ id: row.id });
    }
    return jsonErr("Неизвестное действие");
  });
}
