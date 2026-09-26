/**
 * Peach top-ups via Cashera (SBP / crypto).
 * Card is not offered in product UI — Cashera merchant has card disabled.
 */
import { prisma } from "@/lib/db";
import {
  casheraConfigured,
  createCasheraPayment,
  rubToMinor,
  type CasheraPaymentMethod,
  type CasheraTransaction,
} from "@/lib/cashera";
import { TG_MIN_TOPUP_PEACHES, peachesToRub, peachesToUsdt } from "@/lib/tg-pricing";
import { creditPeaches } from "@/lib/tg/wallet";

/** Methods shown in bot + Mini App. */
export const TOPUP_PAYMENT_METHODS: Array<{
  id: Exclude<CasheraPaymentMethod, "card">;
  labelRu: string;
  labelEn: string;
}> = [
  { id: "sbp", labelRu: "СБП — перевод из банка", labelEn: "SBP — bank transfer" },
  {
    id: "crypto",
    labelRu: "Крипта — USDT",
    labelEn: "Crypto — USDT",
  },
];

export const TOPUP_ACTIVE_METHOD_IDS = TOPUP_PAYMENT_METHODS.map((m) => m.id);

/**
 * Peaches returned to cover payment-provider fee (user pays fee; we rebate in 🍑).
 * Set TG_TOPUP_FEE_REBATE_PCT (e.g. "1.5" for 1.5%). Default 0 until configured.
 */
export function topupFeeRebatePeaches(peaches: number): number {
  const pct = Number(process.env.TG_TOPUP_FEE_REBATE_PCT || "0");
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(0, Math.ceil((Math.floor(peaches) * pct) / 100));
}

export function isActiveTopupMethod(
  method: string,
): method is Exclude<CasheraPaymentMethod, "card"> {
  return (TOPUP_ACTIVE_METHOD_IDS as string[]).includes(method);
}

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
  /** Extra peaches credited on fulfill (pack bonus). Paid amount stays `peaches`. */
  bonusPeaches?: number;
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
  if (!isActiveTopupMethod(opts.method)) {
    throw new Error("Этот способ оплаты недоступен. Выбери СБП или крипту.");
  }
  const peaches = Math.floor(opts.peaches);
  const packBonus = Math.max(0, Math.floor(opts.bonusPeaches || 0));
  const feeRebate = topupFeeRebatePeaches(peaches);
  const bonus = packBonus + feeRebate;
  if (peaches < TG_MIN_TOPUP_PEACHES) {
    throw new Error(`Минимум ${TG_MIN_TOPUP_PEACHES} 🍑`);
  }

  const rub = peachesToRub(peaches);
  const amountMinor = rubToMinor(rub);
  const creditPeaches = peaches + bonus;

  const order = await prisma.paymentOrder.create({
    data: {
      externalId: `pb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      userId: opts.userId,
      peaches: creditPeaches,
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
        packBonus,
        feeRebate,
        creditPeaches,
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
      peaches: creditPeaches,
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

  // Funnel blur trials reset after any successful top-up.
  await prisma.user
    .update({
      where: { id: order.userId },
      data: { tgFunnelV2BlurTrialsUsed: 0 },
    })
    .catch(() => undefined);

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

  void import("@/lib/ops/ops-telegram")
    .then(({ notifyOpsPayment }) =>
      notifyOpsPayment({
        userId: order.userId,
        peaches: order.peaches,
        amountMinor: order.amountMinor,
        method: order.paymentMethod,
        currency: order.currency,
      }),
    )
    .catch(() => undefined);

  return { credited: true, peaches: order.peaches, userId: order.userId };
}
