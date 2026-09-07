import { prisma } from "@/lib/db";
import { tgSendMessage, tgSendPhoto } from "@/lib/tg/telegram-api";
import { normalizeLocale } from "@/lib/tg/i18n";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";

export type BroadcastFilter = {
  who?: "all" | "paid" | "never_paid" | "no_job";
  locale?: "ru" | "en" | "";
  trafficLinkId?: string;
  skipQuietDays?: number;
};

function parseFilter(raw: string): BroadcastFilter {
  try {
    return JSON.parse(raw || "{}") as BroadcastFilter;
  } catch {
    return {};
  }
}

export async function previewBroadcastAudience(filterJson: string) {
  const f = parseFilter(filterJson);
  const where = buildWhere(f);
  return prisma.platformAccount.count({ where });
}

function buildWhere(f: BroadcastFilter) {
  const quietFrom =
    f.skipQuietDays && f.skipQuietDays > 0
      ? new Date(Date.now() - f.skipQuietDays * 86400000)
      : null;
  return {
    platform: "telegram" as const,
    user: {
      blocked: false,
      ...(f.locale ? { locale: f.locale } : {}),
      ...(f.trafficLinkId ? { trafficLinkId: f.trafficLinkId } : {}),
      ...(f.who === "paid"
        ? { ledger: { some: { amount: { gt: 0 }, reason: { contains: "topup" } } } }
        : {}),
      ...(f.who === "never_paid"
        ? { ledger: { none: { amount: { gt: 0 }, reason: { contains: "topup" } } } }
        : {}),
      ...(f.who === "no_job" ? { galleryItems: { none: {} } } : {}),
    },
    ...(quietFrom ? { lastSeenAt: { gte: quietFrom } } : {}),
  };
}

export async function runBroadcast(
  id: string,
  opts?: { skipCooldown?: boolean },
) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row || row.status === "sending") return;
  const settings = await getOpsSettings();
  if (
    !opts?.skipCooldown &&
    settings.lastBroadcastAt &&
    Date.now() - settings.lastBroadcastAt.getTime() < 30 * 60 * 1000
  ) {
    throw new Error("Подожди 30 минут между массовыми рассылками");
  }

  await prisma.broadcast.update({
    where: { id },
    data: { status: "sending" },
  });

  const f = parseFilter(row.filterJson);
  const accounts = await prisma.platformAccount.findMany({
    where: buildWhere(f),
    include: { user: { select: { locale: true } } },
    take: 5000,
  });

  let sent = 0;
  let fail = 0;
  for (const acc of accounts) {
    const locale = normalizeLocale(acc.user.locale);
    const text = locale === "en" && row.bodyEn.trim() ? row.bodyEn : row.bodyRu;
    if (!text.trim()) continue;
    try {
      if (row.mediaUrl.trim()) {
        await tgSendPhoto(acc.platformUserId, row.mediaUrl.trim(), text);
      } else {
        await tgSendMessage(acc.platformUserId, text);
      }
      sent += 1;
    } catch {
      fail += 1;
    }
    await new Promise((r) => setTimeout(r, 50));
    if (sent % 20 === 0) {
      await prisma.broadcast.update({
        where: { id },
        data: { sentCount: sent, failCount: fail },
      });
    }
  }

  await prisma.broadcast.update({
    where: { id },
    data: {
      status: "sent",
      sentCount: sent,
      failCount: fail,
      sentAt: new Date(),
    },
  });
  await saveOpsSettings({ lastBroadcastAt: new Date() });
}

export async function sendTestBroadcast(
  actorUserId: string,
  bodyRu: string,
  bodyEn: string,
  mediaUrl?: string,
) {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId: actorUserId, platform: "telegram" },
  });
  if (!acc) throw new Error("У вас нет Telegram — тест уйдёт только на аккаунт с ботом");
  const user = await prisma.user.findUnique({ where: { id: actorUserId } });
  const locale = normalizeLocale(user?.locale);
  const text = locale === "en" && bodyEn.trim() ? bodyEn : bodyRu;
  if (mediaUrl?.trim()) {
    await tgSendPhoto(acc.platformUserId, mediaUrl.trim(), text);
  } else {
    await tgSendMessage(acc.platformUserId, text);
  }
}
