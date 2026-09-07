import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { langInlineKeyboard } from "@/lib/tg/character-bot";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { tgRulesArticleUrl } from "@/lib/tg/rules";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import {
  tgSupportContact,
  tgSupportUrl,
} from "@/lib/tg/support";

export async function sendHelp(chatId: number, locale: TgLocale) {
  await tgSendMessage(
    chatId,
    tFormat("help_title", locale, {
      support: tgSupportContact(),
    }),
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: t("help_guide_btn", locale),
              web_app: { url: tgMiniAppUrl("guide") },
            },
          ],
          [
            {
              text: t("help_rules_btn", locale),
              url: tgRulesArticleUrl(locale),
            },
          ],
          [
            {
              text: t("help_support_btn", locale),
              url: tgSupportUrl(),
            },
          ],
          [{ text: t("help_lang_btn", locale), callback_data: "help:lang" }],
        ],
      },
    },
  );
}

export async function sendLangSwitch(chatId: number, locale: TgLocale) {
  await tgSendMessage(chatId, t("pick_lang_switch", locale), {
    reply_markup: langInlineKeyboard(),
  });
}
