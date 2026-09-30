/**
 * Funnel v2 hub: rules + main menu (inline only + reply «Главное меню»).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import {
  tgDeleteMessage,
  tgSendMessage,
} from "@/lib/tg/telegram-api";
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import {
  funnelV2RulesAccepted,
  getFunnelBalance,
  userOnFunnelV2,
} from "@/lib/tg/funnel-v2/mode";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";

export function funnelV2ReplyKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: "🏠 Главное меню" }]],
      resize_keyboard: true,
      is_persistent: true,
    },
  };
}

async function attachV2ReplyKb(chatId: number) {
  const platformUserId = String(chatId);
  let already: number | undefined;
  try {
    const acc = await getTgSession(platformUserId);
    if (acc) already = parsePending(acc.pendingJson).replyKbCarrierId;
  } catch {
    /* ignore */
  }
  // Telegram keeps ReplyKeyboard after the first set — don't spam empty carriers.
  if (already) return;

  let sent: { message_id?: number } | undefined;
  try {
    sent = (await tgSendMessage(
      chatId,
      "Кнопка <b>🏠 Главное меню</b> закреплена внизу экрана.",
      {
        ...funnelV2ReplyKeyboard(),
        disable_notification: true,
      },
    )) as { message_id?: number };
  } catch {
    return;
  }
  const mid = sent?.message_id;
  if (mid) {
    await setTgSession(platformUserId, {
      pending: { replyKbCarrierId: mid },
    }).catch(() => undefined);
  }
}

/**
 * Install reply «Главное меню» without leaving the sticky notice as last message.
 * Sends a silent carrier, remembers it, then deletes it (keyboard stays).
 */
export async function attachV2ReplyKbSilent(chatId: number) {
  const platformUserId = String(chatId);
  try {
    const acc = await getTgSession(platformUserId);
    if (acc && parsePending(acc.pendingJson).replyKbCarrierId) return;
  } catch {
    /* ignore */
  }

  let sent: { message_id?: number } | undefined;
  try {
    sent = (await tgSendMessage(chatId, "\u200b", {
      ...funnelV2ReplyKeyboard(),
      disable_notification: true,
    })) as { message_id?: number };
  } catch {
    return;
  }
  const mid = sent?.message_id;
  if (mid) {
    await setTgSession(platformUserId, {
      pending: { replyKbCarrierId: mid },
    }).catch(() => undefined);
    try {
      await tgDeleteMessage(chatId, mid);
    } catch {
      /* keyboard still applied */
    }
  }
}

export function funnelV2RulesKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Принимаю правила и офферту ✅",
          callback_data: FV2.rulesOk,
          style: "success",
        },
      ],
    ],
  };
}

export async function sendFunnelV2Rules(
  chatId: number,
  userId: string,
  locale: TgLocale,
  opts?: { token?: string },
) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgRulesShownAt: new Date(),
      tgRulesNudge10mSent: false,
      tgRulesNudge3hSent: false,
      tgRulesNudge24hSent: false,
    },
  });
  await setTgSession(String(chatId), {
    chatState: "funnel_v2_awaiting_rules",
  });
  const { tgRulesArticleUrl } = await import("@/lib/tg/rules");
  const rulesUrl = tgRulesArticleUrl(locale);
  const text =
    "⚠️ <b>Дальше ты воплотишь все свои фантазии!</b>\n\n" +
    `Но для этого нужно, чтобы ты принял <a href="${rulesUrl}">правила пользования ботом</a> и ознакомился с оффертой, ` +
    "а также подтвердил, что тебе исполнилось 18 лет. Просто нажми на кнопку ниже";
  const { funnelV2ReplaceUi } = await import("@/lib/tg/funnel-v2/ui");
  await funnelV2ReplaceUi(String(chatId), chatId, async () =>
    tgSendMessage(
      chatId,
      text,
      {
        reply_markup: funnelV2RulesKeyboard(),
      },
      opts?.token,
    ),
  );
}

export function funnelV2HubKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "💦 Раздеть и сделать фото 💦",
          callback_data: FV2.photo,
          style: "success",
        },
      ],
      [
        {
          text: "🍓 Сделать горячее видео 🍓",
          callback_data: FV2.video,
          style: "danger",
        },
      ],
      [{ text: "⭐️ PRO режим", callback_data: FV2.pro }],
      [{ text: "🍑 Баланс и пополнение", callback_data: FV2.topup }],
      [
        { text: "🤑 Заработать", callback_data: FV2.earn },
        { text: "ℹ️ Помощь", callback_data: FV2.help },
      ],
    ],
  };
}

export async function buildFunnelV2HubText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const bal = user ? await getFunnelBalance(user) : 0;
  return (
    `<b>Ну что, с чего начнём?</b>\n\n` +
    `Твой баланс: <b>${bal}🍑</b>\n\n` +
    `Вот список того, что я умею делать максимально реалистично:\n\n` +
    `1. Раздеть по 1 фото, поставить её в любую позу 💦 и оживить\n\n` +
    `2. Сделать 🍓 видео с ней по 1 фото с сексом, диалогами, сюжетами по готовым шаблонам\n\n` +
    `3. Сделать PRO образ твоего персонажа, чтобы вывести реализм на новый уровень и делать самые качественные фото/видео в ⭐️ PRO-режиме\n\n` +
    `<a href="https://telegra.ph/Primery-generacij-v-PeachBitch-09-28">🔗Открыть примеры работ</a>\n` +
    `<a href="https://t.me/offpeachbitch">⭐️ Наш официальный канал</a>\n\n` +
    `Выбери, что тебя интересует по кнопкам ниже 👇`
  );
}

export async function sendFunnelV2Hub(
  chatId: number,
  userId: string,
  locale: TgLocale,
  opts?: { editMessageId?: number; editHasMedia?: boolean },
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await userOnFunnelV2(user))) return;
  if (!funnelV2RulesAccepted(user)) {
    await sendFunnelV2Rules(chatId, userId, locale);
    return;
  }

  await setTgSession(String(chatId), {
    chatState: "idle",
    clearPending: true,
  });

  // Opening hub cancels soft 30m blur follow-up (user already saw menu).
  void import("@/lib/tg/funnel-v2/faststart").then(({ cancelFunnelV2FaststartIdle }) =>
    cancelFunnelV2FaststartIdle(userId),
  );

  const text = await buildFunnelV2HubText(userId);
  const markup = funnelV2HubKeyboard();
  const platformUserId = String(chatId);
  const { funnelV2ReplaceUi } = await import("@/lib/tg/funnel-v2/ui");
  const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");

  // Prefer replace carrier over in-place edit (media ↔ text switches break edit).
  void opts;
  await funnelV2ReplaceUi(platformUserId, chatId, () =>
    sendCoverPhoto(chatId, "hub", text, markup),
  );
  await attachV2ReplyKb(chatId);
}

export async function acceptFunnelV2Rules(
  chatId: number,
  userId: string,
  locale: TgLocale,
  messageId?: number,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.tgFunnelV2Preview) {
    await prisma.user.update({
      where: { id: userId },
      data: { tgFunnelV2RulesOk: true, ageConfirmed: true },
    });
  } else if (!user.ageConfirmed) {
    await prisma.user.update({
      where: { id: userId },
      data: { ageConfirmed: true },
    });
  }
  if (messageId) {
    try {
      await tgDeleteMessage(chatId, messageId);
    } catch {
      /* ignore */
    }
  }
  // Single path: hub (faststart CTA after rules removed).
  await sendFunnelV2Hub(chatId, userId, locale);
}
