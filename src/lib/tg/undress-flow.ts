/**
 * Bot undress funnel: disclaimer → confirm → photo → result.
 */
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { HUB_CB, sendMainMenuHub, withBackRow } from "@/lib/tg/menu";
import { undressPeaches } from "@/lib/tg-pricing";
import {
  ensureUndressWelcome,
  getUndressFreeCredits,
} from "@/lib/tg/undress-entitlement";
import { setTgSession } from "@/lib/tg/session";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import { tgAnswerCallbackQuery } from "@/lib/tg/telegram-api";
import { tgDeliverPhoto } from "@/lib/tg/deliver-media";
import { tgMiniAppUrl, tgLoraTrainMiniAppUrl } from "@/lib/tg/miniapp-url";
import { QC_CB } from "@/lib/tg/generation-flow";

export const UNDRESS_CB = {
  open: "ud:open",
  want: "ud:want",
  again: "ud:again",
  feed: "ud:feed",
  hub: "ud:hub",
} as const;

export function undressDisclaimerKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: withBackRow(locale, [
      [{ text: t("undress_want_btn", locale), callback_data: UNDRESS_CB.want }],
      [
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
    ]),
  };
}

export function undressAwaitPhotoKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: [
      [{ text: t("hub_btn_back", locale), callback_data: UNDRESS_CB.open }],
    ],
  };
}

export function undressSuccessKeyboard(
  locale: TgLocale,
  galleryItemId: string,
) {
  return {
    inline_keyboard: [
      [{ text: t("undress_again_btn", locale), callback_data: UNDRESS_CB.again }],
      [
        {
          text: t("undress_open_feed_btn", locale),
          web_app: { url: tgMiniAppUrl() },
        },
      ],
      [{ text: t("gen_to_hub_btn", locale), callback_data: UNDRESS_CB.hub }],
      [
        {
          text: t("qc_dislike_photo_btn", locale),
          callback_data: QC_CB.dislike(galleryItemId),
        },
      ],
    ],
  };
}

export async function sendUndressDisclaimer(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  await ensureUndressWelcome(userId);
  const url = tgAbsoluteUrl("/tg/media/undress-disclaimer.png");
  await tgDeliverPhoto({
    chatId,
    url,
    caption: t("undress_disclaimer", locale),
    extra: { reply_markup: undressDisclaimerKeyboard(locale) },
  });
}

export async function sendUndressAwaitPhoto(
  chatId: number,
  userId: string,
  platformUserId: string,
  locale: TgLocale,
) {
  await ensureUndressWelcome(userId);
  const free = await getUndressFreeCredits(userId);
  const priceLine =
    free >= 1
      ? t("undress_free_line", locale)
      : tFormat("undress_price_line", locale, {
          price: String(undressPeaches()),
        });
  const caption = `${priceLine}\n\n${t("undress_await_photo", locale)}`;
  const url = tgAbsoluteUrl("/tg/media/undress-example.png");
  await tgDeliverPhoto({
    chatId,
    url,
    caption,
    extra: { reply_markup: undressAwaitPhotoKeyboard(locale) },
  });
  await setTgSession(platformUserId, {
    chatState: "awaiting_undress_photo",
    clearPending: true,
  });
}

export async function handleUndressCallback(opts: {
  data: string;
  callbackId: string;
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
}): Promise<boolean> {
  if (!opts.data.startsWith("ud:")) return false;
  await tgAnswerCallbackQuery(opts.callbackId);

  if (opts.data === UNDRESS_CB.open) {
    await sendUndressDisclaimer(opts.chatId, opts.userId, opts.locale);
    await setTgSession(opts.platformUserId, {
      chatState: "idle",
      clearPending: true,
    });
    return true;
  }
  if (opts.data === UNDRESS_CB.want || opts.data === UNDRESS_CB.again) {
    await sendUndressAwaitPhoto(
      opts.chatId,
      opts.userId,
      opts.platformUserId,
      opts.locale,
    );
    return true;
  }
  if (opts.data === UNDRESS_CB.hub) {
    await setTgSession(opts.platformUserId, {
      chatState: "idle",
      clearPending: true,
    });
    await sendMainMenuHub(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  return false;
}
