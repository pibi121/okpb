import type { TgLocale } from "@/lib/tg/i18n";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";

/** After successful funnel photo (full quality). */
export function funnelV2PhotoReadyKeyboard(
  locale: TgLocale,
  galleryItemId: string,
) {
  void locale;
  return {
    inline_keyboard: [
      [
        {
          text: "Редактировать фото ✏️",
          callback_data: FV2.phEdit(galleryItemId),
          style: "success",
        },
        {
          text: "Оживить фото 🎬",
          callback_data: FV2.phAnim(galleryItemId),
          style: "danger",
        },
      ],
      [{ text: "Выбрать другой шаблон 💦", callback_data: FV2.photo }],
      [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
    ],
  };
}

export function funnelV2PhotoBlurKeyboard(_locale: TgLocale) {
  return {
    inline_keyboard: [
      [
        {
          text: "Пополнить баланс 🍑",
          callback_data: FV2.topup,
          style: "success",
        },
      ],
      [{ text: "Выбрать другой шаблон 💦", callback_data: FV2.photo }],
      [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
    ],
  };
}

export function funnelV2VideoReadyKeyboard(_locale: TgLocale) {
  return {
    inline_keyboard: [
      [{ text: "Выбрать другой шаблон 🍓", callback_data: FV2.video }],
      [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
    ],
  };
}
