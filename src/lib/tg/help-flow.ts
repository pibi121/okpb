import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { langInlineKeyboard } from "@/lib/tg/character-bot";
import { tgSendMessage } from "@/lib/tg/telegram-api";

function supportContact(): string {
  return process.env.TG_SUPPORT_CONTACT?.trim() || "@peachbitch_support";
}

function reserveLinks(): string {
  const raw = process.env.TG_RESERVE_LINKS?.trim();
  if (raw) return raw;
  return "t.me/peachbitch_bot";
}

export async function sendHelp(chatId: number, locale: TgLocale) {
  await tgSendMessage(
    chatId,
    tFormat("help_title", locale, {
      support: supportContact(),
      reserves: reserveLinks(),
    }),
    {
      reply_markup: {
        inline_keyboard: [
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
