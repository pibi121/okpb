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
import { funnelV2ReplaceUi } from "@/lib/tg/funnel-v2/ui";
import {
  formatRub,
  formatTopupPackButton,
} from "@/lib/tg/funnel-v2/money";
import { tgSupportUrl } from "@/lib/tg/support";

export const FV2_TOPUP_PACKS: Array<{
  peaches: number;
  bonus: number;
  label: string;
}> = [
  { peaches: 200, bonus: 0, label: formatTopupPackButton(200, 0) },
  { peaches: 1000, bonus: 150, label: formatTopupPackButton(1000, 150) },
  { peaches: 600, bonus: 0, label: formatTopupPackButton(600, 0) },
  { peaches: 5000, bonus: 1200, label: formatTopupPackButton(5000, 1200) },
  { peaches: 2000, bonus: 400, label: formatTopupPackButton(2000, 400) },
  { peaches: 10000, bonus: 2500, label: formatTopupPackButton(10000, 2500) },
];

export function funnelV2TopupPackRows(opts?: {
  /** Amount callbacks from blur result — return to hub after credit. */
  fromBlur?: boolean;
}): Array<Array<Record<string, unknown>>> {
  const prefix = opts?.fromBlur ? "fv2:tu:ba:" : "fv2:tu:a:";
  const packs = FV2_TOPUP_PACKS;
  return [
    [
      { text: packs[0]!.label, callback_data: `${prefix}${packs[0]!.peaches}` },
      { text: packs[1]!.label, callback_data: `${prefix}${packs[1]!.peaches}` },
    ],
    [
      { text: packs[2]!.label, callback_data: `${prefix}${packs[2]!.peaches}` },
      { text: packs[3]!.label, callback_data: `${prefix}${packs[3]!.peaches}` },
    ],
    [
      { text: packs[4]!.label, callback_data: `${prefix}${packs[4]!.peaches}` },
      { text: packs[5]!.label, callback_data: `${prefix}${packs[5]!.peaches}` },
    ],
  ];
}

export function funnelV2SupportRow(): Array<Record<string, unknown>> {
  return [{ text: "❓Техподдержка", url: tgSupportUrl() }];
}

export async function sendFunnelV2Topup(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const bal = user ? await getFunnelBalance(user) : 0;
  const usdt1 = peachesToUsdt(1);
  const body =
    `У тебя на балансе: <b>${formatRub(bal)}</b>\n\n` +
    `1₽ на балансе = 1 рубль / ${usdt1}$\n\n` +
    `Пополни баланс от ${formatRub(1000)} и получай бонус сверху (бонусы пропадают, лучше воспользоваться сразу)\n\n` +
    `Выбери сумму для пополнения:`;

  const rows: Array<Array<Record<string, unknown>>> = [
    ...funnelV2TopupPackRows(),
    [{ text: "⬅️ Назад", callback_data: FV2.hub }],
  ];

  const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
  await funnelV2ReplaceUi(String(chatId), chatId, () =>
    sendCoverPhoto(chatId, "topup", body, { inline_keyboard: rows }),
  );
  void locale;
}

export async function handleFunnelV2TopupAmount(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  peaches: number,
  opts?: { fromBlur?: boolean },
) {
  const pack = FV2_TOPUP_PACKS.find((p) => p.peaches === peaches);
  const bonus = pack?.bonus || 0;
  const usdt = peachesToUsdt(peaches);
  const bonusLine = bonus
    ? `\n\n+ бонусные: <b>${formatRub(bonus)}</b>`
    : "";
  const body =
    `Пополнение баланса на <b>${formatRub(peaches)}</b>${bonusLine}\n\n` +
    `Сумма: ${peaches} рублей / ${usdt}$\n\n` +
    `Как удобнее оплатить?`;

  await setTgSession(platformUserId, {
    chatState: "awaiting_topup_method",
    pending: {
      funnelV2TopupPeaches: peaches,
      funnelV2TopupBonus: bonus,
      topupPeaches: peaches,
      topupBonusPeaches: bonus,
      funnelV2ReturnHubAfterTopup: Boolean(opts?.fromBlur),
      ...(opts?.fromBlur ? { funnelV2Unblur: undefined } : {}),
    },
  });

  const { funnelV2TopupMethodKeyboard } = await import("@/lib/tg/topup-flow");
  const kb = funnelV2TopupMethodKeyboard(locale, peaches);
  await funnelV2ReplaceUi(platformUserId, chatId, () =>
    tgSendMessage(chatId, body, {
      reply_markup: kb,
    }),
  );
}

/** Fallback: open classic Cashera flow for real payments outside preview. */
export async function sendFunnelV2TopupClassic(
  chatId: number,
  locale: TgLocale,
) {
  await sendTopupPrompt(chatId, locale);
}
