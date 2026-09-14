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
  TOPUP_PAYMENT_METHODS,
} from "@/lib/tg/topup-payments";
import type { CasheraPaymentMethod } from "@/lib/cashera";

export function topupInlineKeyboard(locale: TgLocale) {
  const rows = TG_QUICK_TOPUP_AMOUNTS.map((n) => [
    { text: `🍑 ${n}`, callback_data: TOPUP_CB.amount(n) },
  ]);
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

export async function sendTopupPrompt(chatId: number, locale: TgLocale) {
  const usdt = peachesToUsdt(TG_MIN_TOPUP_PEACHES);
  await setTgSession(String(chatId), {
    chatState: "awaiting_topup_amount",
    clearPending: true,
  });
  await tgSendMediaMessage(
    chatId,
    "topup",
    tFormat("topup_prompt", locale, { usdt }),
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
    await tgSendMessage(chatId, tFormat("topup_min_error", locale, { usdt }), {
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

  try {
    const pay = await createTopupPayment({
      userId,
      peaches,
      method,
      locale,
    });
    await setTgSession(platformUserId, {
      chatState: "idle",
      clearPending: true,
    });
    const methodLabel =
      TOPUP_PAYMENT_METHODS.find((m) => m.id === method)?.[
        locale === "en" ? "labelEn" : "labelRu"
      ] || method;

    await tgSendMessage(
      chatId,
      tFormat("topup_pay_link", locale, {
        price: pay.priceLine,
        method: methodLabel,
      }),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  locale === "en" ? "Open payment form →" : "Открыть оплату →",
                url: pay.paymentUrl,
              },
            ],
            [
              {
                text: locale === "en" ? "← Change method" : "← Другой способ",
                callback_data: TOPUP_CB.amount(peaches),
              },
            ],
          ],
        },
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
