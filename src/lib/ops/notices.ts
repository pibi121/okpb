import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";

export const NOTICE_SLOTS = [
  {
    slot: "queue_long",
    title: "Длинная очередь",
    textRu:
      "Сейчас очередь чуть длиннее обычного — ориентир {minutes} мин. Как будет готово, пришлём сюда.",
    textEn:
      "The queue is a bit longer than usual — about {minutes} min. We'll send the result here.",
  },
  {
    slot: "gen_fail_our_fault",
    title: "Генерация упала не по вине человека",
    textRu:
      "Не получилось собрать кадр — это сбой у нас, не у тебя. Персики за эту попытку вернутся. Можно запустить ещё раз.",
    textEn:
      "We failed to render this one — that's on us, not you. Peaches for this attempt come back. You can try again.",
  },
  {
    slot: "lora_fail",
    title: "Обучение модели упало",
    textRu:
      "Обучение не дошло до конца — это сбой у нас. Фото загружать заново не нужно. Напиши в поддержку или попробуй ещё раз позже.",
    textEn:
      "Training didn't finish — that's on us. You don't need to re-upload photos. Ping support or try again later.",
  },
  {
    slot: "payment_ok",
    title: "Оплата прошла",
    textRu: "Пополнение дошло ✅ На баланс зачислено {n} 🍑",
    textEn: "Payment received ✅ {n} 🍑 added to your balance",
  },
  {
    slot: "payment_fail",
    title: "Оплата не прошла",
    textRu:
      "Платёж не дошёл. Деньги не списались. Попробуй ещё раз или напиши в поддержку.",
    textEn:
      "The payment didn't go through. Nothing was charged. Try again or message support.",
  },
  {
    slot: "train_ready",
    title: "Модель обучилась",
    textRu: "Модель готова ✅ Можно снимать фото в Mini App.",
    textEn: "Your model is ready ✅ You can shoot photos in the Mini App.",
  },
  {
    slot: "account_limited",
    title: "Аккаунт ограничен",
    textRu: "Доступ к боту ограничен. Если это ошибка — напиши в поддержку.",
    textEn: "Access to the bot is limited. If this is a mistake, message support.",
  },
  {
    slot: "load",
    title: "Большая нагрузка (всем)",
    textRu:
      "Сейчас большая нагрузка на студию. Новые генерации идут медленнее. Можно подождать в очереди.",
    textEn:
      "The studio is under heavy load. New generations are slower. You can wait in the queue.",
  },
  {
    slot: "maintenance",
    title: "Техработы (всем)",
    textRu:
      "Сейчас техработы. Генерации на паузе. Как закончим — напишем сюда.",
    textEn:
      "Short maintenance. Generations are paused. We'll message you when we're back.",
  },
  {
    slot: "bot_move",
    title: "Бот переехал",
    textRu:
      "Этот бот больше не основной. Открой новый по ссылке — баланс и персонажи на месте: {url}",
    textEn:
      "This bot is no longer the main one. Open the new link — balance and characters stay: {url}",
  },
  {
    slot: "works_planned",
    title: "Плановые работы",
    textRu:
      "Скоро короткие техработы. Лучше дождаться, если генерация не срочная.",
    textEn:
      "A short maintenance window is coming. If your generation isn't urgent, wait a bit.",
  },
] as const;

export type NoticeSlot = (typeof NOTICE_SLOTS)[number]["slot"];

let noticeCache: {
  at: number;
  map: Record<string, { textRu: string; textEn: string; enabled: boolean }>;
} | null = null;

export async function seedSystemNotices() {
  for (const n of NOTICE_SLOTS) {
    await prisma.systemNotice.upsert({
      where: { slot: n.slot },
      create: {
        slot: n.slot,
        title: n.title,
        textRu: n.textRu,
        textEn: n.textEn,
        enabled: true,
      },
      update: {},
    });
  }
}

export async function getNoticeMap() {
  if (noticeCache && Date.now() - noticeCache.at < 8000) return noticeCache.map;
  await seedSystemNotices();
  const rows = await prisma.systemNotice.findMany();
  const map: Record<string, { textRu: string; textEn: string; enabled: boolean }> =
    {};
  for (const r of rows) {
    map[r.slot] = { textRu: r.textRu, textEn: r.textEn, enabled: r.enabled };
  }
  noticeCache = { at: Date.now(), map };
  return map;
}

export function invalidateNotices() {
  noticeCache = null;
}

export async function formatNotice(
  slot: NoticeSlot,
  locale: TgLocale,
  vars: Record<string, string | number> = {},
): Promise<string | null> {
  const map = await getNoticeMap();
  const row = map[slot];
  if (!row || !row.enabled) return null;
  let s = locale === "en" ? row.textEn : row.textRu;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Mass-send a system notice template to the audience (ops «отправить сейчас»). */
export async function sendNoticeBroadcastNow(slot: string, actorId: string) {
  const notice = await prisma.systemNotice.findUnique({ where: { slot } });
  if (!notice) throw new Error("Уведомление не найдено");
  if (!notice.textRu.trim()) throw new Error("Нужен русский текст");

  const { runBroadcast } = await import("@/lib/ops/broadcast");
  const row = await prisma.broadcast.create({
    data: {
      title: `Notice · ${notice.title}`,
      bodyRu: notice.textRu,
      bodyEn: notice.textEn,
      mediaUrl: notice.mediaUrl || "",
      filterJson: JSON.stringify({ who: "all", skipQuietDays: 0 }),
      createdById: actorId,
      status: "draft",
    },
  });
  await runBroadcast(row.id, { skipCooldown: true });
  return { broadcastId: row.id };
}
