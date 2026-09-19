import { prisma } from "@/lib/db";
import {
  tgSendMessage,
  tgSendPhoto,
  tgSendVideo,
  tgApi,
} from "@/lib/tg/telegram-api";
import { normalizeLocale } from "@/lib/tg/i18n";
import { saveOpsSettings } from "@/lib/ops/settings";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";

export type BroadcastFilter = {
  who?: "all" | "paid" | "never_paid" | "no_job";
  locale?: "ru" | "en" | "";
  trafficLinkId?: string;
  skipQuietDays?: number;
};

export type BroadcastMediaItem = {
  type: "photo" | "video";
  url: string;
};

export type BroadcastButton = {
  text: string;
  /** Mini App path under /tg/, e.g. "photo", "video?templateId=…", "characters?section=train" */
  path: string;
};

function parseFilter(raw: string): BroadcastFilter {
  try {
    return JSON.parse(raw || "{}") as BroadcastFilter;
  } catch {
    return {};
  }
}

function parseMediaJson(raw: string, legacyUrl?: string): BroadcastMediaItem[] {
  try {
    const v = JSON.parse(raw || "[]") as BroadcastMediaItem[];
    if (Array.isArray(v) && v.length) {
      return v
        .filter((m) => m?.url?.trim())
        .slice(0, 2)
        .map((m) => ({
          type: m.type === "video" ? "video" : "photo",
          url: m.url.trim(),
        }));
    }
  } catch {
    /* ignore */
  }
  if (legacyUrl?.trim()) {
    const u = legacyUrl.trim();
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(u);
    return [{ type: isVideo ? "video" : "photo", url: u }];
  }
  return [];
}

function parseButtonsJson(raw: string): BroadcastButton[] {
  try {
    const v = JSON.parse(raw || "[]") as BroadcastButton[];
    if (!Array.isArray(v)) return [];
    return v
      .filter((b) => b?.text?.trim() && typeof b.path === "string")
      .slice(0, 6)
      .map((b) => ({
        text: b.text.trim().slice(0, 64),
        path: b.path.trim().replace(/^\//, ""),
      }));
  } catch {
    return [];
  }
}

function buttonsMarkup(buttons: BroadcastButton[]) {
  if (!buttons.length) return undefined;
  const rows: Array<Array<{ text: string; web_app: { url: string } }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = buttons.slice(i, i + 2).map((b) => ({
      text: b.text,
      web_app: { url: tgMiniAppUrl(b.path.replace(/^\//, "")) },
    }));
    rows.push(row);
  }
  return { inline_keyboard: rows };
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

async function deliverBroadcastPayload(
  chatId: string | number,
  text: string,
  media: BroadcastMediaItem[],
  buttons: BroadcastButton[],
) {
  const markup = buttonsMarkup(buttons);
  if (media.length >= 2) {
    await tgApi("sendMediaGroup", {
      chat_id: chatId,
      media: media.map((m, i) => ({
        type: m.type,
        media: m.url,
        ...(i === 0 && text.trim()
          ? { caption: text, parse_mode: "HTML" }
          : {}),
      })),
    });
    if (markup) {
      await tgSendMessage(
        chatId,
        buttons.length ? "👇" : text || "·",
        { reply_markup: markup },
      );
    } else if (!text.trim()) {
      /* album only */
    }
    return;
  }
  if (media.length === 1) {
    const m = media[0]!;
    const extra = markup ? { reply_markup: markup } : {};
    if (m.type === "video") {
      await tgSendVideo(chatId, m.url, text || undefined, extra);
    } else {
      await tgSendPhoto(chatId, m.url, text || undefined, extra);
    }
    return;
  }
  await tgSendMessage(chatId, text, markup ? { reply_markup: markup } : {});
}

export async function runBroadcast(
  id: string,
  _opts?: { skipCooldown?: boolean },
) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  if (row.status === "sending") throw new Error("Рассылка уже отправляется");
  if (row.status === "sent") throw new Error("Рассылка уже отправлена");

  await prisma.broadcast.update({
    where: { id },
    data: { status: "sending", sentCount: 0, failCount: 0 },
  });

  // Heavy fan-out continues in background; caller already got "started".
  void processBroadcastSend(id).catch(async (e) => {
    console.error("[ops] broadcast send:", e);
    try {
      await prisma.broadcast.update({
        where: { id },
        data: { status: "draft" },
      });
    } catch {
      /* ignore */
    }
  });
}

async function processBroadcastSend(id: string) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row || row.status !== "sending") return;

  const f = parseFilter(row.filterJson);
  const media = parseMediaJson(row.mediaJson, row.mediaUrl);
  const buttons = parseButtonsJson(row.buttonsJson);
  const accounts = await prisma.platformAccount.findMany({
    where: buildWhere(f),
    include: { user: { select: { locale: true } } },
    take: 5000,
  });

  let sent = 0;
  let fail = 0;
  for (const acc of accounts) {
    const locale = normalizeLocale(acc.user.locale);
    const bodyEn = row.bodyEn || "";
    const bodyRu = row.bodyRu || "";
    const text = locale === "en" && bodyEn.trim() ? bodyEn : bodyRu;
    if (!text.trim() && !media.length) continue;
    try {
      await deliverBroadcastPayload(acc.platformUserId, text, media, buttons);
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

export async function deleteBroadcast(id: string) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  if (row.status === "sending") {
    throw new Error("Нельзя удалить рассылку, пока она отправляется");
  }
  await prisma.broadcast.delete({ where: { id } });
}

export async function sendTestBroadcast(opts: {
  actorUserId: string;
  bodyRu: string;
  bodyEn: string;
  mediaUrl?: string;
  mediaJson?: string;
  buttonsJson?: string;
  /** Explicit Telegram user id for preview (overrides actor's own TG). */
  testTgId?: string;
}) {
  let chatId = (opts.testTgId || "").trim().replace(/\s+/g, "");
  if (chatId && !/^\d{5,15}$/.test(chatId)) {
    throw new Error("Telegram id — только цифры (user id, не @username)");
  }
  if (!chatId) {
    const acc = await prisma.platformAccount.findFirst({
      where: { userId: opts.actorUserId, platform: "telegram" },
    });
    if (!acc) {
      throw new Error(
        "Укажите Telegram id для теста или привяжите свой TG к ops-аккаунту",
      );
    }
    chatId = acc.platformUserId;
  }
  const user = await prisma.user.findUnique({ where: { id: opts.actorUserId } });
  const locale = normalizeLocale(user?.locale);
  const text =
    locale === "en" && (opts.bodyEn || "").trim()
      ? opts.bodyEn
      : opts.bodyRu || "";
  const media = parseMediaJson(opts.mediaJson || "[]", opts.mediaUrl);
  const buttons = parseButtonsJson(opts.buttonsJson || "[]");
  if (!text.trim() && !media.length) {
    throw new Error("Нужен текст RU или хотя бы одно медиа");
  }
  await deliverBroadcastPayload(chatId, text, media, buttons);
}

/** Suggested Mini App button presets for the ops UI. */
export const BROADCAST_BUTTON_PRESETS: BroadcastButton[] = [
  { text: "Лента", path: "" },
  { text: "Фото по образу", path: "photo" },
  { text: "Видео", path: "video" },
  { text: "Витрина моделей", path: "characters" },
  { text: "Обучить свою", path: "characters?section=train" },
  { text: "Галерея", path: "gallery" },
  { text: "Пополнить", path: "topup" },
  { text: "Гайд", path: "guide" },
];
