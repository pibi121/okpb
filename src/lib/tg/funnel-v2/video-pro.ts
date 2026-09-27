import type { TgLocale } from "@/lib/tg/i18n";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { tgLoraTrainMiniAppUrl, tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { funnelV2ReplaceUi } from "@/lib/tg/funnel-v2/ui";

export async function sendFunnelV2Pro(chatId: number, _locale: TgLocale) {
  await funnelV2ReplaceUi(String(chatId), chatId, () =>
    tgSendMessage(
      chatId,
      "<b>PRO-режим</b> — это выход на совершенно новый уровень удовольствия, реализма и качества.\n\n" +
        "Чтобы генерировать профессиональные фото, видео и фильмы со своей геронией, у тебя должен быть создан её образ через наше мини-приложение в Telegram.\n\n" +
        "Но перед этим мы рекомендуем заглянуть в ленту и посмотреть на примеры фото/видео, которые можно создавать. Там тебя ждут уже готовые героини, многие из которых тебе покажутся знакомыми.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Открыть ленту",
                web_app: { url: tgMiniAppUrl() },
                style: "success",
              },
              {
                text: "Создать PRO-образ",
                web_app: { url: tgLoraTrainMiniAppUrl() },
                style: "danger",
              },
            ],
            [
              {
                text: "Как это работает?",
                web_app: { url: tgMiniAppUrl("guide") },
                style: "primary",
              },
            ],
            [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
          ],
        },
      },
    ),
  );
}
