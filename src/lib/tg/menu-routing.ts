import type { TgLocale } from "@/lib/tg/i18n";
import { isMenuText, t, tFormat } from "@/lib/tg/i18n";
import {
  HUB_CB,
  editOrSendNavMessage,
  sendMainMenuHub,
  withBackRow,
  TG_COMMUNITY_URL,
} from "@/lib/tg/menu";
import { sendGenerationKindPicker } from "@/lib/tg/onboarding-flow";
import { sendCharactersList } from "@/lib/tg/character-bot";
import { sendHelp } from "@/lib/tg/help-flow";
import { sendTopupPrompt, topupInlineKeyboard } from "@/lib/tg/topup-flow";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { getBalancePeaches } from "@/lib/tg/wallet";
import { TG_MIN_TOPUP_PEACHES, peachesToUsdt } from "@/lib/tg-pricing";
import { sendTemplatePicker } from "@/lib/tg/generation-flow";
import { tgRulesArticleUrl } from "@/lib/tg/rules";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import { tgSupportContact, tgSupportUrl } from "@/lib/tg/support";

/** Leave input states (topup, speech, etc.) and open hub. */
export async function goToMainMenu(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  opts?: { editMessageId?: number; editHasMedia?: boolean },
) {
  await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  await sendMainMenuHub(chatId, userId, locale, {
    attachReplyKeyboard: !opts?.editMessageId,
    editMessageId: opts?.editMessageId,
    editHasMedia: opts?.editHasMedia,
  });
}

async function showHelpInPlace(
  chatId: number,
  locale: TgLocale,
  messageId?: number,
  hasMedia?: boolean,
) {
  const rows = withBackRow(locale, [
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
  ]);
  await editOrSendNavMessage({
    chatId,
    text: tFormat("help_title", locale, { support: tgSupportContact() }),
    reply_markup: { inline_keyboard: rows },
    messageId,
    hasMedia,
  });
}

async function showTopupInPlace(
  chatId: number,
  locale: TgLocale,
  messageId?: number,
  hasMedia?: boolean,
) {
  const usdt = peachesToUsdt(TG_MIN_TOPUP_PEACHES);
  await setTgSession(String(chatId), {
    chatState: "awaiting_topup_amount",
    clearPending: true,
  });
  const kb = topupInlineKeyboard(locale);
  const rows = withBackRow(locale, kb.inline_keyboard as Array<
    Array<Record<string, unknown>>
  >);
  await editOrSendNavMessage({
    chatId,
    text: tFormat("topup_prompt", locale, { usdt }),
    reply_markup: { inline_keyboard: rows },
    messageId,
    hasMedia,
  });
}

async function showEarnInPlace(
  chatId: number,
  userId: string,
  locale: TgLocale,
  messageId?: number,
  hasMedia?: boolean,
) {
  const { getPartnerDashboard, partnerStartLink } = await import(
    "@/lib/tg/partner-program"
  );
  const { TG_AFFILIATE_ATTRIBUTION_NOTE } = await import("@/lib/tg/rules");
  const dash = await getPartnerDashboard(userId);
  const mainUrl = partnerStartLink(dash.botUsername, dash.profile.code);
  const body = [
    tFormat("earn_dash", locale, {
      referrals: String(dash.referrals),
      purchases: String(dash.purchases),
      gross: String(dash.purchaseGrossPeaches),
      earned: String(dash.commissionPeaches),
      balance: String(dash.profile.balancePeaches),
      link: mainUrl,
    }),
    "",
    TG_AFFILIATE_ATTRIBUTION_NOTE[locale],
  ].join("\n");
  const rows = withBackRow(locale, [
    [
      {
        text: t("earn_open_partner_btn", locale),
        web_app: { url: tgMiniAppUrl("/tg/partner") },
      },
    ],
  ]);
  await editOrSendNavMessage({
    chatId,
    text: body,
    reply_markup: { inline_keyboard: rows },
    messageId,
    hasMedia,
  });
}

/** Hub inline buttons — edit the same message when possible. */
export async function handleHubCallback(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  data: string,
  messageId?: number,
  hasMedia?: boolean,
): Promise<boolean> {
  if (!data.startsWith("hub:")) return false;

  if (data === HUB_CB.back) {
    await goToMainMenu(chatId, platformUserId, userId, locale, {
      editMessageId: messageId,
      editHasMedia: hasMedia,
    });
    return true;
  }

  if (data === HUB_CB.topup) {
    await showTopupInPlace(chatId, locale, messageId, hasMedia);
    return true;
  }

  if (data === HUB_CB.help) {
    await showHelpInPlace(chatId, locale, messageId, hasMedia);
    return true;
  }

  if (data === HUB_CB.earn) {
    await showEarnInPlace(chatId, userId, locale, messageId, hasMedia);
    return true;
  }

  if (data === HUB_CB.undress) {
    const { sendUndressDisclaimer } = await import("@/lib/tg/undress-flow");
    await sendUndressDisclaimer(chatId, userId, locale);
    await setTgSession(platformUserId, {
      chatState: "idle",
      clearPending: true,
    });
    return true;
  }

  if (
    data === HUB_CB.videoOne ||
    data === HUB_CB.photoLook ||
    data === HUB_CB.videoLook
  ) {
    const kind = data === HUB_CB.photoLook ? "photo" : "video";
    const videoMode =
      data === HUB_CB.videoLook
        ? ("look" as const)
        : data === HUB_CB.videoOne
          ? ("one_photo" as const)
          : undefined;
    const { templates } = await sendTemplatePicker(
      chatId,
      userId,
      locale,
      kind,
      0,
      {
        editMessageId: messageId,
        editHasMedia: hasMedia,
        replaceText: true,
        showBack: true,
        reshuffle: true,
        videoMode,
      },
    );
    await setTgSession(platformUserId, {
      chatState: "idle",
      clearPending: true,
      pending: {
        templateKind: kind,
        ...(videoMode ? { videoMode } : {}),
        templatePage: 0,
        templateIds: templates.map((x) => x.id),
      },
    });
    return true;
  }

  return false;
}

/** Bottom keyboard navigation — always wins over state handlers. */
export async function routeMenuText(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  text: string,
): Promise<boolean> {
  if (!text) return false;

  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  const trackMenu = (eventKey: string) =>
    trackFunnelEventBg({ userId, platformUserId, eventKey, surface: "bot" });

  if (isMenuText(text, "menu_main")) {
    trackMenu("bot.menu.main");
    await goToMainMenu(chatId, platformUserId, userId, locale);
    return true;
  }
  // Legacy reply-keyboard labels (kept until clients refresh keyboard).
  if (isMenuText(text, "menu_generation")) {
    trackMenu("bot.menu.generation");
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
    await sendGenerationKindPicker(chatId, locale);
    return true;
  }
  if (isMenuText(text, "menu_characters")) {
    trackMenu("bot.menu.characters");
    await setTgSession(platformUserId, { chatState: "idle" });
    await sendCharactersList(chatId, userId, platformUserId, locale);
    return true;
  }
  if (isMenuText(text, "menu_balance")) {
    trackMenu("bot.menu.balance");
    await setTgSession(platformUserId, { chatState: "idle" });
    const bal = await getBalancePeaches(userId);
    await tgSendMessage(chatId, tFormat("balance_with_topup_hint", locale, { n: bal }), {
      reply_markup: {
        inline_keyboard: [[{ text: t("topup_btn", locale), callback_data: "tu:open" }]],
      },
    });
    return true;
  }
  if (isMenuText(text, "menu_earn")) {
    trackMenu("bot.menu.earn");
    await setTgSession(platformUserId, { chatState: "idle" });
    await showEarnInPlace(chatId, userId, locale);
    return true;
  }
  if (isMenuText(text, "menu_community")) {
    trackMenu("bot.menu.community");
    await setTgSession(platformUserId, { chatState: "idle" });
    await tgSendMessage(chatId, t("community_text", locale), {
      reply_markup: {
        inline_keyboard: [
          [{ text: t("community_open_btn", locale), url: TG_COMMUNITY_URL }],
        ],
      },
    });
    return true;
  }
  if (isMenuText(text, "menu_help")) {
    trackMenu("bot.menu.help");
    await setTgSession(platformUserId, { chatState: "idle" });
    await sendHelp(chatId, locale);
    return true;
  }
  if (isMenuText(text, "topup_btn") || isMenuText(text, "hub_btn_topup")) {
    trackMenu("bot.menu.topup");
    await sendTopupPrompt(chatId, locale);
    return true;
  }

  return false;
}
