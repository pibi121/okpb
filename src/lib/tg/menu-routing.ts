import type { TgLocale } from "@/lib/tg/i18n";
import { isMenuText, t, tFormat } from "@/lib/tg/i18n";
import { sendMainMenuHub, TG_COMMUNITY_URL } from "@/lib/tg/menu";
import { sendGenerationKindPicker } from "@/lib/tg/onboarding-flow";
import { sendCharactersList } from "@/lib/tg/character-bot";
import { sendHelp } from "@/lib/tg/help-flow";
import { sendTopupPrompt } from "@/lib/tg/topup-flow";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { getBalancePeaches } from "@/lib/tg/wallet";

/** Leave input states (topup, speech, etc.) and open hub. */
export async function goToMainMenu(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
) {
  await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  await sendMainMenuHub(chatId, userId, locale);
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
    const { getPartnerDashboard, partnerStartLink } = await import(
      "@/lib/tg/partner-program"
    );
    const { tgMiniAppUrl } = await import("@/lib/tg/miniapp-url");
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
    await tgSendMessage(chatId, body, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: t("earn_open_partner_btn", locale),
              web_app: { url: tgMiniAppUrl("/tg/partner") },
            },
          ],
        ],
      },
    });
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
  if (isMenuText(text, "topup_btn")) {
    trackMenu("bot.menu.topup");
    await sendTopupPrompt(chatId, locale);
    return true;
  }

  return false;
}
