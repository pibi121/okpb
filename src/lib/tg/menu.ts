import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { getBalancePeaches } from "@/lib/tg/wallet";

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

export async function sendMainMenuHub(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  const bal = await getBalancePeaches(userId);
  await tgSendMediaMessage(
    chatId,
    "welcome",
    tFormat("hub_main", locale, { balance: bal }),
    {
      ...mainMenuKeyboard(locale),
    },
  );
}
