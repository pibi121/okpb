/**
 * Peach top-ups via Cashera (SBP / card / crypto).
 */
import { prisma } from "@/lib/db";
import {
  casheraConfigured,
  createCasheraPayment,
  rubToMinor,
  type CasheraPaymentMethod,
  type CasheraTransaction,
} from "@/lib/cashera";
import { peachesToRub, peachesToUsdt } from "@/lib/tg-pricing";
import { creditPeaches } from "@/lib/tg/wallet";

export const TOPUP_PAYMENT_METHODS: Array<{
  id: CasheraPaymentMethod;
  labelRu: string;
  labelEn: string;
}> = [
  { id: "sbp", labelRu: "Пополнить через СБП", labelEn: "Pay via SBP" },
  { id: "card", labelRu: "Пополнить картой", labelEn: "Pay by card" },
  {
    id: "crypto",
    labelRu: "Пополнить криптовалютой",
    labelEn: "Pay with crypto",
  },
];

export function formatTopupPriceLine(
  peaches: number,
  locale: "ru" | "en" = "ru",
): string {
  const rub = peachesToRub(peaches);
  const usd = peachesToUsdt(peaches);
  if (locale === "en") {
    return `${peaches} 🍑 = ${rub} ₽ (≈ $${usd})`;
  }
  return `${peaches} 🍑 = ${rub} ₽ (≈ $${usd})`;
}

export async function createTopupPayment(opts: {
  userId: string;
  peaches: number;
  method: CasheraPaymentMethod;
  locale?: "ru" | "en";
}): Promise<{
  orderId: string;
  externalId: string;
  paymentUrl: string;
  casheraUuid: string;
  amountMinor: number;
  peaches: number;
  priceLine: string;
}> {
  if (!casheraConfigured()) {
    throw new Error("Платежи ещё не настроены (нет ключей Cashera)");
  }
  const peaches = Math.floor(opts.peaches);
  if (peaches < 100) throw new Error("Минимум 100 🍑");

  const rub = peachesToRub(peaches);
  const amountMinor = rubToMinor(rub);
  // Card minimum 100.00 RUB (= 10000 minor) — already covered by min peaches.
  if (opts.method === "card" && amountMinor < 10000) {
    throw new Error("Для оплаты картой минимум 100 ₽");
  }

  const order = await prisma.paymentOrder.create({
    data: {
      externalId: `pb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      userId: opts.userId,
      peaches,
      amountMinor,
      currency: "RUB",
      paymentMethod: opts.method,
      status: "pending",
    },
  });

  try {
    const tx = await createCasheraPayment({
      amountMinor,
      paymentMethod: opts.method,
      externalId: order.externalId,
      description:
        opts.locale === "en"
          ? `PeachBitch top-up ${peaches} peaches`
          : `Пополнение PeachBitch ${peaches} персиков`,
      metadata: {
        userId: opts.userId,
        peaches,
        orderId: order.id,
        method: opts.method,
      },
    });

    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        casheraUuid: tx.uuid,
        paymentUrl: tx.payment_url || "",
        status: tx.status || "pending",
        rawStatusJson: JSON.stringify(tx).slice(0, 8000),
      },
    });

    return {
      orderId: order.id,
      externalId: order.externalId,
      paymentUrl: String(tx.payment_url),
      casheraUuid: tx.uuid,
      amountMinor,
      peaches,
      priceLine: formatTopupPriceLine(peaches, opts.locale || "ru"),
    };
  } catch (e) {
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        rawStatusJson: JSON.stringify({
          error: e instanceof Error ? e.message : String(e),
        }).slice(0, 4000),
      },
    });
    throw e;
  }
}

/** Credit peaches once when Cashera reports paid (idempotent). */
export async function fulfillPaidTopup(opts: {
  externalId: string;
  transaction: CasheraTransaction;
}): Promise<{ credited: boolean; peaches?: number; userId?: string }> {
  const order = await prisma.paymentOrder.findUnique({
    where: { externalId: opts.externalId },
  });
  if (!order) {
    console.warn("[cashera] unknown external_id", opts.externalId);
    return { credited: false };
  }

  const status = String(opts.transaction.status || "").toLowerCase();
  await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status,
      casheraUuid: opts.transaction.uuid || order.casheraUuid,
      rawStatusJson: JSON.stringify(opts.transaction).slice(0, 8000),
      paidAt:
        status === "paid"
          ? order.paidAt || new Date()
          : order.paidAt,
    },
  });

  if (status !== "paid") {
    return { credited: false, peaches: order.peaches, userId: order.userId };
  }

  if (order.creditedAt) {
    return { credited: false, peaches: order.peaches, userId: order.userId };
  }

  // Amount check: expect kopecks == peaches * 100 when 1🍑=1₽
  const expected = order.amountMinor;
  const got = Number(opts.transaction.amount);
  if (Number.isFinite(got) && got > 0 && got !== expected) {
    console.error(
      "[cashera] amount mismatch",
      order.externalId,
      { expected, got },
    );
    return { credited: false, peaches: order.peaches, userId: order.userId };
  }

  // Mark credited first (optimistic lock via creditedAt null check in update)
  const locked = await prisma.paymentOrder.updateMany({
    where: { id: order.id, creditedAt: null, status: "paid" },
    data: { creditedAt: new Date() },
  });
  if (locked.count === 0) {
    return { credited: false, peaches: order.peaches, userId: order.userId };
  }

  await creditPeaches(order.userId, order.peaches, "tg_topup_cashera", {
    orderId: order.id,
    externalId: order.externalId,
    casheraUuid: opts.transaction.uuid,
    paymentMethod: order.paymentMethod,
    amountMinor: order.amountMinor,
  });

  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId: order.userId,
    eventKey: "bot.topup.paid",
    meta: {
      amount: order.peaches,
      method: order.paymentMethod,
      provider: "cashera",
    },
  });

  return { credited: true, peaches: order.peaches, userId: order.userId };
}
