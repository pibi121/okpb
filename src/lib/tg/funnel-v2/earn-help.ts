/**
 * Earn + Help for funnel v2 — same copy + tagged partner links in-bot.
 */
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { tgRulesArticleUrl, tgAffiliateAttributionNote } from "@/lib/tg/rules";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import { tgSupportContact, tgSupportUrl } from "@/lib/tg/support";
import { setTgSession } from "@/lib/tg/session";

export async function showHelpInPlaceProxy(chatId: number, locale: TgLocale) {
  await tgSendMessage(
    chatId,
    tFormat("help_title", locale, { support: tgSupportContact() }),
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
          [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
        ],
      },
    },
  );
}

export async function showEarnInPlaceProxy(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  const { getPartnerDashboard, partnerStartLink, partnerBridgeLink } =
    await import("@/lib/tg/partner-program");
  const dash = await getPartnerDashboard(userId);
  const mainUrl = partnerStartLink(dash.botUsername, dash.profile.code);
  const bridgeUrl = partnerBridgeLink(dash.profile.code);
  const pct = String(dash.profile.commissionPct || 50);
  const body = tFormat("earn_dash", locale, {
    referrals: String(dash.referrals),
    purchases: String(dash.purchases),
    gross: String(dash.purchaseGrossPeaches),
    earned: String(dash.commissionPeaches),
    balance: String(dash.profile.balancePeaches),
    pct,
    link: mainUrl,
    bridge: bridgeUrl || mainUrl,
  });

  await tgSendMessage(
    chatId,
    body + "\n\n" + tgAffiliateAttributionNote(locale, Number(pct)),
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📊 Открыть партнёрку в Mini App",
              web_app: { url: tgMiniAppUrl("partner") },
            },
          ],
          [
            {
              text: "🔗 Ссылки с метками 🔗",
              callback_data: FV2.earnLinks,
            },
          ],
          [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
        ],
      },
    },
  );
}

export async function sendFunnelV2EarnLinks(
  chatId: number,
  userId: string,
  _locale: TgLocale,
) {
  const {
    getPartnerDashboard,
    partnerStartLink,
    partnerBridgeLink,
  } = await import("@/lib/tg/partner-program");
  const dash = await getPartnerDashboard(userId);
  const lines: string[] = [
    "<b>Ссылки с метками</b>",
    "Клики / запуски / продажи / выручка / прибыль по каждой метке:",
    "",
  ];

  for (const l of dash.links.slice(0, 12)) {
    const slug = l.slug === "main" ? undefined : l.slug;
    const botUrl = partnerStartLink(dash.botUsername, dash.profile.code, slug);
    const bridge = partnerBridgeLink(dash.profile.code, slug);
    const profit = l.commissionPeaches ?? 0;
    lines.push(
      `<b>${l.label || l.slug}</b>`,
      `Клики: ${l.clicks} · Запуски: ${l.signups} · Покупки: ${l.purchases ?? 0}`,
      `Выручка: ${l.purchaseGrossPeaches ?? 0}🍑 · Прибыль: ${profit}🍑`,
      `🤖 <code>${botUrl}</code>`,
      `🌐 <code>${bridge}</code>`,
      "",
    );
  }

  if (dash.links.length === 0) {
    lines.push("Пока нет меток — создай первую кнопкой ниже.");
  }

  await tgSendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "➕ Создать ссылку с меткой",
            callback_data: FV2.earnNew,
          },
        ],
        [{ text: "⬅️ Назад", callback_data: FV2.earn }],
        [{ text: "⬅️ Главное меню", callback_data: FV2.hub }],
      ],
    },
  });
}

export async function beginFunnelV2EarnNewLink(
  chatId: number,
  platformUserId: string,
) {
  await setTgSession(platformUserId, {
    chatState: "funnel_v2_awaiting_partner_label",
  });
  await tgSendMessage(
    chatId,
    "Напиши <b>название метки</b> одним сообщением (например: <code>stories_sept</code> или <code>Блогер Аня</code>).",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Отмена", callback_data: FV2.earnLinks }],
        ],
      },
    },
  );
}

export async function handleFunnelV2EarnNewLabel(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  label: string;
}) {
  const label = opts.label.trim().slice(0, 80);
  if (!label) {
    await tgSendMessage(opts.chatId, "Пустое название — напиши ещё раз.");
    return;
  }
  try {
    const { createPartnerLink, partnerStartLink, partnerBridgeLink, getPartnerDashboard } =
      await import("@/lib/tg/partner-program");
    const link = await createPartnerLink(opts.userId, label);
    const dash = await getPartnerDashboard(opts.userId);
    const slug = link.slug === "main" ? undefined : link.slug;
    const botUrl = partnerStartLink(dash.botUsername, dash.profile.code, slug);
    const bridge = partnerBridgeLink(dash.profile.code, slug);
    await setTgSession(opts.platformUserId, {
      chatState: "idle",
      clearPending: true,
    });
    await tgSendMessage(
      opts.chatId,
      `✅ Метка <b>${link.label}</b> создана.\n\n` +
        `🤖 Бот: <code>${botUrl}</code>\n` +
        `🌐 Домен: <code>${bridge}</code>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔗 Все ссылки", callback_data: FV2.earnLinks }],
            [{ text: "⬅️ Главное меню", callback_data: FV2.hub }],
          ],
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await tgSendMessage(opts.chatId, `Не удалось создать: ${msg}`);
  }
  void opts.locale;
}
