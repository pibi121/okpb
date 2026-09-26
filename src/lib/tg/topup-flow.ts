/**
 * Bot + shared top-up UX (amount → method → Cashera payment_url).
 */
import {
  TG_MIN_TOPUP_PEACHES,
  TG_QUICK_TOPUP_AMOUNTS,
  peachesToUsdt,
} from "@/lib/tg-pricing";
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { TOPUP_CB } from "@/lib/tg/generation-flow";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { casheraConfigured } from "@/lib/cashera";
import {
  createTopupPayment,
  formatTopupPriceLine,
  isActiveTopupMethod,
  TOPUP_PAYMENT_METHODS,
} from "@/lib/tg/topup-payments";
import type { CasheraPaymentMethod } from "@/lib/cashera";
import { prisma } from "@/lib/db";

export function topupInlineKeyboard(locale: TgLocale) {
  const rows = TG_QUICK_TOPUP_AMOUNTS.map((n) => [
    { text: `🍑 ${n}`, callback_data: TOPUP_CB.amount(n) },
  ]);
  void locale;
  return { inline_keyboard: rows };
}

export function topupMethodKeyboard(locale: TgLocale, peaches: number) {
  const rows = TOPUP_PAYMENT_METHODS.map((m) => [
    {
      text: locale === "en" ? m.labelEn : m.labelRu,
      callback_data: TOPUP_CB.method(m.id),
    },
  ]);
  rows.push([
    {
      text: locale === "en" ? "← Other amount" : "← Другая сумма",
      callback_data: "tu:open",
    },
  ]);
  void peaches;
  return { inline_keyboard: rows };
}

function payLinkKeyboard(opts: {
  locale: TgLocale;
  paymentUrl: string;
  peaches: number;
  orderId: string;
}) {
  return {
    inline_keyboard: [
      [
        {
          text:
            opts.locale === "en" ? "Open payment →" : "Открыть оплату →",
          url: opts.paymentUrl,
        },
      ],
      [
        {
          text:
            opts.locale === "en" ? "New payment link" : "Новая ссылка на оплату",
          callback_data: TOPUP_CB.renew(opts.orderId),
        },
      ],
      [
        {
          text:
            opts.locale === "en" ? "← Change method" : "← Другой способ",
          callback_data: TOPUP_CB.amount(opts.peaches),
        },
      ],
    ],
  };
}

function payLinkCopyKey(method: string): "topup_pay_link_sbp" | "topup_pay_link_crypto" {
  return method === "crypto" ? "topup_pay_link_crypto" : "topup_pay_link_sbp";
}

export async function sendTopupPrompt(chatId: number, locale: TgLocale) {
  const usdt = peachesToUsdt(TG_MIN_TOPUP_PEACHES);
  await setTgSession(String(chatId), {
    chatState: "awaiting_topup_amount",
    clearPending: true,
  });
  await tgSendMediaMessage(
    chatId,
    "topup",
    tFormat("topup_prompt", locale, {
      usdt,
      min: TG_MIN_TOPUP_PEACHES,
    }),
    {
      reply_markup: topupInlineKeyboard(locale),
    },
  );
}

export async function handleTopupAmount(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  amount: number,
  userId?: string,
) {
  if (amount < TG_MIN_TOPUP_PEACHES) {
    const usdt = peachesToUsdt(TG_MIN_TOPUP_PEACHES);
    await tgSendMessage(chatId, tFormat("topup_min_error", locale, {
      usdt,
      min: TG_MIN_TOPUP_PEACHES,
    }), {
      reply_markup: topupInlineKeyboard(locale),
    });
    return;
  }

  await setTgSession(platformUserId, {
    chatState: "awaiting_topup_method",
    pending: { topupPeaches: amount },
  });

  const priceLine = formatTopupPriceLine(amount, locale);
  if (!casheraConfigured()) {
    await tgSendMessage(
      chatId,
      tFormat("topup_payments_offline", locale, { price: priceLine }),
      { reply_markup: topupInlineKeyboard(locale) },
    );
    return;
  }

  await tgSendMessage(
    chatId,
    tFormat("topup_choose_method", locale, { price: priceLine }),
    { reply_markup: topupMethodKeyboard(locale, amount) },
  );
  void userId;
}

export async function handleTopupMethod(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  method: CasheraPaymentMethod,
  userId: string,
  peaches: number,
) {
  if (peaches < TG_MIN_TOPUP_PEACHES) {
    await sendTopupPrompt(chatId, locale);
    return;
  }
  if (!isActiveTopupMethod(method)) {
    await tgSendMessage(
      chatId,
      t("topup_method_unavailable", locale),
      { reply_markup: topupMethodKeyboard(locale, peaches) },
    );
    return;
  }

  try {
    const { getTgSession, parsePending } = await import("@/lib/tg/session");
    const sess = await getTgSession(platformUserId);
    const pend = parsePending(sess?.pendingJson || "{}");
    const bonus = Number(pend.topupBonusPeaches || pend.funnelV2TopupBonus || 0);
    const pay = await createTopupPayment({
      userId,
      peaches,
      bonusPeaches: bonus > 0 ? bonus : undefined,
      method,
      locale,
    });
    await setTgSession(platformUserId, {
      chatState: "idle",
      clearPending: true,
    });

    await tgSendMessage(
      chatId,
      tFormat(payLinkCopyKey(method), locale, {
        price: pay.priceLine,
      }),
      {
        reply_markup: payLinkKeyboard({
          locale,
          paymentUrl: pay.paymentUrl,
          peaches,
          orderId: pay.orderId,
        }),
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "payment error";
    await tgSendMessage(
      chatId,
      tFormat("topup_pay_error", locale, { msg }),
      { reply_markup: topupMethodKeyboard(locale, peaches) },
    );
  }
}

/** Re-create Cashera link for an unpaid order (reminder / renew button). */
export async function handleTopupRenew(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  userId: string,
  orderId: string,
) {
  const order = await prisma.paymentOrder.findFirst({
    where: { id: orderId, userId },
  });
  if (!order || !isActiveTopupMethod(order.paymentMethod)) {
    await sendTopupPrompt(chatId, locale);
    return;
  }
  if (order.status === "paid" || order.creditedAt) {
    await tgSendMessage(chatId, t("topup_already_paid", locale));
    return;
  }

  // Mark old pending as canceled so we don't keep reminding on a dead link.
  if (order.status === "pending") {
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: "canceled" },
    });
  }

  await handleTopupMethod(
    chatId,
    platformUserId,
    locale,
    order.paymentMethod as CasheraPaymentMethod,
    userId,
    order.peaches,
  );
}

export async function sendInsufficientBalance(
  chatId: number,
  locale: TgLocale,
  need: number,
  balance: number,
) {
  await tgSendMessage(
    chatId,
    tFormat("gen_insufficient", locale, { need, balance }),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: t("topup_btn", locale), callback_data: "tu:open" }],
        ],
      },
    },
  );
}
