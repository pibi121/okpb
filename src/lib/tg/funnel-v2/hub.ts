/**
 * Funnel v2 hub: rules + main menu (inline only + reply «Главное меню»).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  tgDeleteMessage,
  tgSendMessage,
  tgEditMessageText,
  tgEditMessageCaption,
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
  let prev: number | undefined;
  try {
    const acc = await getTgSession(platformUserId);
    if (acc) prev = parsePending(acc.pendingJson).replyKbCarrierId;
  } catch {
    /* ignore */
  }
  let sent: { message_id?: number } | undefined;
  try {
    sent = (await tgSendMessage(chatId, "\u2060", {
      ...funnelV2ReplyKeyboard(),
      disable_notification: true,
    })) as { message_id?: number };
  } catch {
    sent = (await tgSendMessage(chatId, "👇", {
      ...funnelV2ReplyKeyboard(),
      disable_notification: true,
    })) as { message_id?: number };
  }
  const mid = sent?.message_id;
  if (mid) {
    await setTgSession(platformUserId, {
      pending: { replyKbCarrierId: mid },
    }).catch(() => undefined);
  }
  if (prev && prev !== mid) {
    try {
      await tgDeleteMessage(chatId, prev);
    } catch {
      /* ignore */
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
  _locale: TgLocale,
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
  const text =
    "⚠️ <b>Дальше ты воплотишь все свои фантазии!</b>\n\n" +
    "Но для этого нужно, чтобы ты принял правила пользования ботом и ознакомился с оффертой, " +
    "а также подтвердил, что тебе исполнилось 18 лет. Просто нажми на кнопку ниже";
  await tgSendMessage(chatId, text, {
    reply_markup: funnelV2RulesKeyboard(),
  });
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
  const examples = tgAbsoluteUrl("/tg");
  return (
    `<b>Ну что, с чего начнём?</b>\n` +
    `Твой баланс: <b>${bal}🍑</b>\n` +
    `Вот список того, что я умею делать максимально реалистично:\n` +
    `1. Раздеть по 1 фото, поставить её в любую позу 💦 и оживить\n` +
    `2. Сделать 🍓 видео с ней по 1 фото с сексом, диалогами, сюжетами по готовым шаблонам\n` +
    `3. Сделать PRO образ твоего персонажа, чтобы вывести реализм на новый уровень и делать самые качественные фото/видео в ⭐️ PRO-режиме\n` +
    `<a href="${examples}">🔗Открыть примеры работ</a>\n` +
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

  const text = await buildFunnelV2HubText(userId);
  const markup = funnelV2HubKeyboard();

  if (opts?.editMessageId) {
    try {
      if (opts.editHasMedia) {
        await tgEditMessageCaption(chatId, opts.editMessageId, text, {
          reply_markup: markup,
        });
      } else {
        await tgEditMessageText(chatId, opts.editMessageId, text, {
          reply_markup: markup,
        });
      }
    } catch {
      const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
      await sendCoverPhoto(chatId, "hub", text, markup);
    }
  } else {
    const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
    await sendCoverPhoto(chatId, "hub", text, markup);
  }
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
  await sendFunnelV2Hub(chatId, userId, locale);
}
