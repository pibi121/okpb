/**
 * Funnel v2 top-up amounts + bonuses (TZ).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { peachesToUsdt } from "@/lib/tg-pricing";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { setTgSession } from "@/lib/tg/session";
import { getFunnelBalance } from "@/lib/tg/funnel-v2/mode";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { sendTopupPrompt } from "@/lib/tg/topup-flow";

export const FV2_TOPUP_PACKS: Array<{
  peaches: number;
  bonus: number;
  label: string;
}> = [
  { peaches: 200, bonus: 0, label: "200🍑" },
  { peaches: 1000, bonus: 150, label: "1000🍑 + 150 бонус" },
  { peaches: 600, bonus: 0, label: "600🍑" },
  { peaches: 5000, bonus: 1200, label: "5000🍑 + 1200 бонус" },
  { peaches: 2000, bonus: 400, label: "2000🍑 + 400 бонус" },
  { peaches: 10000, bonus: 2500, label: "10 000🍑 + 2500 бонус" },
];

export async function sendFunnelV2Topup(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const bal = user ? await getFunnelBalance(user) : 0;
  const usdt1 = peachesToUsdt(1);
  const text =
    `У тебя на балансе: <b>${bal}🍑</b>\n` +
    `1🍑 = 1 рубль / ${usdt1}$\n\n` +
    `Пополни баланс от 1000🍑 и получай бонусные персики сверху (бонусы пропадают, лучше воспользоваться сразу)\n\n` +
    `Выбери сумму для пополнения:`;

  const rows: Array<Array<Record<string, unknown>>> = [
    [
      { text: "200🍑", callback_data: "fv2:tu:a:200" },
      { text: "1000🍑 + 150 бонус", callback_data: "fv2:tu:a:1000" },
    ],
    [
      { text: "600🍑", callback_data: "fv2:tu:a:600" },
      { text: "5000🍑 + 1200 бонус", callback_data: "fv2:tu:a:5000" },
    ],
    [
      { text: "2000🍑 + 400 бонус", callback_data: "fv2:tu:a:2000" },
      { text: "10 000🍑 + 2500 бонус", callback_data: "fv2:tu:a:10000" },
    ],
    [{ text: "⬅️ Назад", callback_data: FV2.hub }],
  ];

  const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
  await sendCoverPhoto(chatId, "topup", text, { inline_keyboard: rows });
  void locale;
}

export async function handleFunnelV2TopupAmount(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  peaches: number,
) {
  const pack = FV2_TOPUP_PACKS.find((p) => p.peaches === peaches);
  const bonus = pack?.bonus || 0;
  const usdt = peachesToUsdt(peaches);
  const { topupFeeRebatePeaches } = await import("@/lib/tg/topup-payments");
  const feeRebate = topupFeeRebatePeaches(peaches);
  const bonusLine = bonus
    ? `\n+ бонусные: <b>${bonus}🍑</b>`
    : "";
  const feeLine = feeRebate
    ? `\n+ возврат комиссии: <b>${feeRebate}🍑</b>`
    : "";
  const text =
    `Пополнение баланса на <b>${peaches}🍑</b>${bonusLine}${feeLine}\n` +
    `Сумма: ${peaches} рублей / ${usdt}$ (комиссию платёжной системы мы вернём в виде дополнительных 🍑 вместе с бонусными)\n\n` +
    `Выбери способ для пополнения:`;

  await setTgSession(platformUserId, {
    chatState: "awaiting_topup_method",
    pending: {
      funnelV2TopupPeaches: peaches,
      funnelV2TopupBonus: bonus,
      topupPeaches: peaches,
      topupBonusPeaches: bonus,
    },
  });

  // Reuse existing payment method keyboard from classic topup.
  const { topupMethodKeyboard } = await import("@/lib/tg/topup-flow");
  const kb = topupMethodKeyboard(locale, peaches);
  const rows = [
    ...(kb.inline_keyboard as Array<Array<Record<string, unknown>>>),
    [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
  ];
  await tgSendMessage(chatId, text, {
    reply_markup: { inline_keyboard: rows },
  });
}

/** Fallback: open classic Cashera flow for real payments outside preview. */
export async function sendFunnelV2TopupClassic(
  chatId: number,
  locale: TgLocale,
) {
  await sendTopupPrompt(chatId, locale);
}
