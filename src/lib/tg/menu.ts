import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { tgMiniAppUrl, tgLoraTrainMiniAppUrl } from "@/lib/tg/miniapp-url";
import { getBalancePeaches } from "@/lib/tg/wallet";
import {
  tgDeleteMessage,
  tgEditMessageCaption,
  tgEditMessageText,
  tgSendMessage,
} from "@/lib/tg/telegram-api";

/** TG invite / community chat (same for RU and EN). */
export const TG_COMMUNITY_URL = "https://t.me/+6aVo5HU0Yrc4NjYy";

/** Inline hub navigation callbacks. */
export const HUB_CB = {
  videoOne: "hub:v1",
  photoLook: "hub:ph",
  videoLook: "hub:vl",
  topup: "hub:tu",
  help: "hub:hp",
  earn: "hub:earn",
  back: "hub:back",
} as const;

/** Bottom reply keyboard: main menu + open studio Mini App. */
export function mainMenuKeyboard(locale: TgLocale) {
  return {
    reply_markup: {
      keyboard: [
        [
          { text: t("menu_main", locale) },
          {
            text: t("menu_open_studio", locale),
            web_app: { url: tgMiniAppUrl() },
          },
        ],
      ],
      resize_keyboard: true,
    },
  };
}

export function mainMenuExtra(locale: TgLocale) {
  return mainMenuKeyboard(locale);
}

/**
 * Telegram can set a reply keyboard only via a sent message, and cannot mix it
 * with inline buttons on the same message. Send a silent carrier, then delete
 * it — the bottom keyboard stays.
 */
async function attachReplyKeyboardSilent(chatId: number, locale: TgLocale) {
  const extra: Record<string, unknown> = {
    ...mainMenuExtra(locale),
    disable_notification: true,
  };
  let sent: { message_id?: number } | undefined;
  try {
    sent = (await tgSendMessage(chatId, "\u2060", extra)) as {
      message_id?: number;
    };
  } catch {
    sent = (await tgSendMessage(chatId, "👇", extra)) as { message_id?: number };
  }
  const messageId = sent?.message_id;
  if (!messageId) return;
  try {
    await tgDeleteMessage(chatId, messageId);
  } catch {
    /* keyboard is already attached even if the carrier stays */
  }
}

/** Inline CTAs under hub message. */
export function hubInlineKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: [
      [
        { text: t("hub_btn_video_one", locale), callback_data: HUB_CB.videoOne },
        {
          text: t("hub_btn_photo_look", locale),
          callback_data: HUB_CB.photoLook,
        },
      ],
      [
        {
          text: t("hub_btn_video_look", locale),
          callback_data: HUB_CB.videoLook,
        },
        {
          text: t("hub_btn_create_look", locale),
          web_app: { url: tgLoraTrainMiniAppUrl() },
        },
      ],
      [
        { text: t("hub_btn_topup", locale), callback_data: HUB_CB.topup },
        { text: t("hub_btn_help", locale), callback_data: HUB_CB.help },
      ],
      [{ text: t("hub_btn_earn", locale), callback_data: HUB_CB.earn }],
    ],
  };
}

/** Welcome free offer removed — starter peaches instead. */
export async function shouldShowWelcomeFreeOffer(
  _userId: string,
): Promise<boolean> {
  return false;
}

export async function buildHubCaption(
  userId: string,
  locale: TgLocale,
): Promise<string> {
  const bal = await getBalancePeaches(userId);
  return tFormat("hub_main", locale, { balance: bal });
}

/** Edit existing bot message in-place, or send a new text message. */
export async function editOrSendNavMessage(opts: {
  chatId: number;
  text: string;
  reply_markup: Record<string, unknown>;
  messageId?: number;
  hasMedia?: boolean;
}): Promise<void> {
  const { chatId, text, reply_markup, messageId, hasMedia } = opts;
  if (messageId) {
    try {
      if (hasMedia) {
        await tgEditMessageCaption(chatId, messageId, text, { reply_markup });
      } else {
        await tgEditMessageText(chatId, messageId, text, { reply_markup });
      }
      return;
    } catch {
      /* message gone / not editable — fall through */
    }
  }
  await tgSendMessage(chatId, text, { reply_markup });
}

export function withBackRow(
  locale: TgLocale,
  rows: Array<Array<Record<string, unknown>>>,
): Array<Array<Record<string, unknown>>> {
  return [
    ...rows,
    [{ text: t("hub_btn_back", locale), callback_data: HUB_CB.back }],
  ];
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
  opts?: {
    attachReplyKeyboard?: boolean;
    /** Edit this message back to hub (in-place nav). */
    editMessageId?: number;
    editHasMedia?: boolean;
  },
) {
  const caption = await buildHubCaption(userId, locale);
  const markup = hubInlineKeyboard(locale);

  if (opts?.editMessageId) {
    await editOrSendNavMessage({
      chatId,
      text: caption,
      reply_markup: markup,
      messageId: opts.editMessageId,
      hasMedia: opts.editHasMedia,
    });
    return;
  }

  const attachKb = opts?.attachReplyKeyboard !== false;
  await tgSendMediaMessage(chatId, "welcome", caption, {
    reply_markup: markup,
  });
  // Telegram: one message can't mix inline + reply keyboard.
  if (attachKb) {
    await attachReplyKeyboardSilent(chatId, locale);
  }
}
