import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import { getBalancePeaches } from "@/lib/tg/wallet";
import { tgSendMessage } from "@/lib/tg/telegram-api";

/** TG invite / community chat (same for RU and EN). */
export const TG_COMMUNITY_URL = "https://t.me/+6aVo5HU0Yrc4NjYy";

/** Bottom reply keyboard: sections + hub. */
export function mainMenuKeyboard(locale: TgLocale) {
  return {
    reply_markup: {
      keyboard: [
        [
          { text: t("menu_generation", locale) },
          { text: t("menu_characters", locale) },
        ],
        [
          { text: t("menu_balance", locale) },
          { text: t("menu_earn", locale) },
        ],
        [
          { text: t("menu_community", locale) },
          { text: t("menu_help", locale) },
        ],
        [{ text: t("menu_main", locale) }],
      ],
      resize_keyboard: true,
    },
  };
}

export function mainMenuExtra(locale: TgLocale) {
  return mainMenuKeyboard(locale);
}

/** Inline CTAs under hub message (web_app). */
export function hubInlineKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: [
      [
        {
          text: t("hub_open_studio_btn", locale),
          web_app: { url: tgMiniAppUrl() },
        },
      ],
      [
        {
          text: t("hub_guide_btn", locale),
          web_app: { url: tgMiniAppUrl("guide") },
        },
      ],
    ],
  };
}

/** After generation starts — open Mini App feed. */
export function genStartingExtra(locale: TgLocale) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("gen_view_feed_btn", locale),
            web_app: { url: tgMiniAppUrl() },
          },
        ],
      ],
    },
  };
}

export async function sendMainMenuHub(
  chatId: number,
  userId: string,
  locale: TgLocale,
  opts?: { attachReplyKeyboard?: boolean },
) {
  const bal = await getBalancePeaches(userId);
  const attachKb = opts?.attachReplyKeyboard !== false;
  await tgSendMediaMessage(
    chatId,
    "welcome",
    tFormat("hub_main", locale, { balance: bal }),
    {
      reply_markup: hubInlineKeyboard(locale),
    },
  );
  // Telegram: one message can't mix inline + reply keyboard.
  if (attachKb) {
    await tgSendMessage(chatId, t("menu_ready_hint", locale), mainMenuExtra(locale));
  }
}
