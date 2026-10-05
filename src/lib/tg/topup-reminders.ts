/**
 * Remind users with pending SBP/crypto top-ups; include open + renew buttons.
 */
import { prisma } from "@/lib/db";
import { tFormat, type TgLocale } from "@/lib/tg/i18n";
import { TOPUP_CB } from "@/lib/tg/generation-flow";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import {
  formatTopupPriceLine,
  isActiveTopupMethod,
  TOPUP_PAYMENT_METHODS,
} from "@/lib/tg/topup-payments";
import { parseXpayOrderMeta } from "@/lib/tg/xpay-topup";

const TICK_MS = 60_000;
/** First nudge after this age. */
const FIRST_AFTER_MS = 8 * 60_000;
/** Second (final) nudge after this age from createdAt. */
const SECOND_AFTER_MS = 25 * 60_000;
const MAX_REMINDS = 2;
/** Don't remind forever-old pending rows. */
const MAX_AGE_MS = 6 * 60 * 60_000;

let started = false;

function methodLabel(method: string, locale: TgLocale): string {
  const row = TOPUP_PAYMENT_METHODS.find((m) => m.id === method);
  if (!row) return method;
  return locale === "en" ? row.labelEn : row.labelRu;
}

export async function tickTopupReminders(): Promise<number> {
  const now = Date.now();
  const oldest = new Date(now - MAX_AGE_MS);
  const firstCutoff = new Date(now - FIRST_AFTER_MS);

  const candidates = await prisma.paymentOrder.findMany({
    where: {
      status: "pending",
      creditedAt: null,
      paymentUrl: { not: "" },
      remindCount: { lt: MAX_REMINDS },
      createdAt: { gte: oldest, lte: firstCutoff },
      paymentMethod: { in: ["sbp", "crypto", "cryptobot", "kz_card", "uz_card"] },
    },
    orderBy: { createdAt: "asc" },
    take: 40,
  });

  let sent = 0;
  for (const order of candidates) {
    if (!isActiveTopupMethod(order.paymentMethod) || !order.paymentUrl) continue;

    const age = now - order.createdAt.getTime();
    const needFirst = order.remindCount === 0 && age >= FIRST_AFTER_MS;
    const needSecond = order.remindCount === 1 && age >= SECOND_AFTER_MS;
    if (!needFirst && !needSecond) continue;

    const locked = await prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: "pending",
        creditedAt: null,
        remindCount: order.remindCount,
      },
      data: {
        remindCount: { increment: 1 },
        lastRemindedAt: new Date(),
      },
    });
    if (locked.count === 0) continue;

    const user = await prisma.user.findUnique({
      where: { id: order.userId },
      select: { locale: true },
    });
    const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
    const xpayMeta = parseXpayOrderMeta(order.rawStatusJson);
    const price = xpayMeta?.payLine
      ? xpayMeta.payLine
      : formatTopupPriceLine(order.peaches, locale);
    const method = methodLabel(order.paymentMethod, locale);
    const againAmount =
      xpayMeta?.selectedRub ||
      (xpayMeta
        ? Math.max(1, Math.round(order.amountMinor / 100))
        : order.peaches);

    const { resolveUserTelegramDelivery } = await import(
      "@/lib/tg/notify-user"
    );
    const dest = await resolveUserTelegramDelivery(order.userId);
    const token = dest?.token;
    if (!token || !dest) continue;

    try {
      await tgSendMessage(
        dest.chatId,
        tFormat("topup_remind", locale, { price, method }),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    locale === "en" ? "Open payment →" : "Открыть оплату →",
                  url: order.paymentUrl,
                },
              ],
              [
                {
                  text:
                    locale === "en"
                      ? "New payment link"
                      : "Новая ссылка на оплату",
                  callback_data: TOPUP_CB.renew(order.id),
                },
              ],
              [
                {
                  text: locale === "en" ? "← Change method" : "← Другой способ",
                  callback_data: TOPUP_CB.amount(againAmount),
                },
              ],
            ],
          },
        },
        token,
      );
      sent += 1;
      const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
      trackFunnelEventBg({
        userId: order.userId,
        platformUserId: dest.platformUserId,
        eventKey: "bot.topup.remind",
        surface: "system",
        meta: {
          orderId: order.id,
          method: order.paymentMethod,
          peaches: order.peaches,
          remindCount: order.remindCount + 1,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[topup-remind] send failed", order.id, msg);
      // Dead chats: stop further nudges (same pattern as funnel drip).
      if (
        /bot was blocked|chat not found|user is deactivated|Forbidden: bot|PEER_ID_INVALID/i.test(
          msg,
        )
      ) {
        await prisma.paymentOrder
          .update({
            where: { id: order.id },
            data: { remindCount: MAX_REMINDS },
          })
          .catch(() => undefined);
      }
    }
  }
  return sent;
}

export function startTopupReminderWatcher() {
  if (started) return;
  started = true;
  console.log(
    `[topup-remind] started tick=${TICK_MS}ms first=${FIRST_AFTER_MS / 60000}m second=${SECOND_AFTER_MS / 60000}m`,
  );
  const run = () => {
    void tickTopupReminders()
      .then((n) => {
        if (n > 0) console.log(`[topup-remind] sent ${n}`);
      })
      .catch((e) =>
        console.error(
          "[topup-remind] tick:",
          e instanceof Error ? e.message : e,
        ),
      );
  };
  setTimeout(run, 45_000);
  setInterval(run, TICK_MS);
}
