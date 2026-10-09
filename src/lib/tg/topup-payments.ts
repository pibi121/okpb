/**
 * Peach top-ups via Cashera (SBP / crypto) and StreamPay (KZ/BY/UA).
 * StreamPay SBP reserve (`sp_sbp`) stays in code for fulfill/webhooks but is hidden from UI.
 */
import { prisma } from "@/lib/db";
import {
  casheraConfigured,
  createCasheraPayment,
  rubToMinor,
  type CasheraPaymentMethod,
  type CasheraTransaction,
} from "@/lib/cashera";
import {
  TG_MAX_TOPUP_PEACHES,
  TG_MIN_TOPUP_PEACHES,
  peachesToRub,
  peachesToUsdt,
} from "@/lib/tg-pricing";
import { creditPeaches } from "@/lib/tg/wallet";

/** Cashera methods still offered in UI. */
export type CasheraTopupMethod = "sbp" | "crypto" | "cryptobot";

export type StreampayTopupMethodId =
  | "sp_sbp"
  | "sp_kz"
  | "sp_by"
  | "sp_ua";

export type TopupPaymentMethodId = CasheraTopupMethod | StreampayTopupMethodId;

/** Methods shown in bot + Mini App — order matches TZ. */
export const TOPUP_PAYMENT_METHODS: Array<{
  id: TopupPaymentMethodId;
  labelRu: string;
  labelEn: string;
  /** Telegram Bot API inline button style (primary/success/danger). */
  style: "primary" | "success" | "danger";
  provider: "cashera" | "streampay";
}> = [
  {
    id: "sbp",
    labelRu: "🇷🇺 Оплатить по СБП (рублями)",
    labelEn: "🇷🇺 Pay via SBP (RUB)",
    style: "success",
    provider: "cashera",
  },
  {
    id: "crypto",
    labelRu: "₿ Криптой (USDT, BTC, ETH и т.д)",
    labelEn: "₿ Crypto (USDT, BTC, ETH…)",
    style: "danger",
    provider: "cashera",
  },
  {
    id: "sp_kz",
    labelRu: "🇰🇿 Картой КЗ",
    labelEn: "🇰🇿 Kazakhstan card",
    style: "primary",
    provider: "streampay",
  },
  {
    id: "sp_by",
    labelRu: "🇧🇾 Картой Беларуси",
    labelEn: "🇧🇾 Belarus card",
    style: "primary",
    provider: "streampay",
  },
  {
    id: "sp_ua",
    labelRu: "🇺🇦 Картой Украины",
    labelEn: "🇺🇦 Ukraine card",
    style: "primary",
    provider: "streampay",
  },
];

export const TOPUP_ACTIVE_METHOD_IDS = TOPUP_PAYMENT_METHODS.map((m) => m.id);

/** Hidden from UI; still fulfillable if an old order exists. */
export const TOPUP_HIDDEN_METHOD_IDS: TopupPaymentMethodId[] = ["sp_sbp"];

/**
 * Fee rebate %: user pays provider fee on the checkout page; we return it as 🍑.
 * Cashera: cabinet rates. StreamPay: store fee 4.5% (client pays 100%).
 */
export const TOPUP_FEE_REBATE_PCT: Record<string, number> = {
  sbp: 13,
  crypto: 3,
  cryptobot: 5,
  sp_sbp: 4.5,
  sp_kz: 4.5,
  sp_by: 4.5,
  sp_ua: 4.5,
};

/**
 * Peaches returned to cover payment-provider fee for the chosen method.
 */
export function topupFeeRebatePeaches(
  peaches: number,
  method: string,
): number {
  const pct = TOPUP_FEE_REBATE_PCT[method];
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(0, Math.ceil((Math.floor(peaches) * pct) / 100));
}

export function isActiveTopupMethod(
  method: string,
): method is TopupPaymentMethodId {
  return (TOPUP_ACTIVE_METHOD_IDS as string[]).includes(method);
}

/** UI methods + hidden-but-still-valid (e.g. pending sp_sbp). */
export function isKnownTopupMethod(
  method: string,
): method is TopupPaymentMethodId {
  return (
    isActiveTopupMethod(method) ||
    (TOPUP_HIDDEN_METHOD_IDS as string[]).includes(method)
  );
}

export function isCasheraTopupMethod(
  method: string,
): method is CasheraTopupMethod {
  return method === "sbp" || method === "crypto" || method === "cryptobot";
}

export function isStreampayMethodId(
  method: string,
): method is StreampayTopupMethodId {
  return (
    method === "sp_sbp" ||
    method === "sp_kz" ||
    method === "sp_by" ||
    method === "sp_ua"
  );
}

export function formatTopupPriceLine(
  peaches: number,
  locale: "ru" | "en" = "ru",
): string {
  const rub = peachesToRub(peaches);
  const usd = peachesToUsdt(peaches);
  void locale;
  return `${rub} ₽ (≈ $${usd})`;
}

export async function createTopupPayment(opts: {
  userId: string;
  peaches: number;
  /** Extra peaches credited on fulfill (pack bonus). Paid amount stays `peaches`. */
  bonusPeaches?: number;
  method: CasheraPaymentMethod | TopupPaymentMethodId;
  locale?: "ru" | "en";
}): Promise<{
  orderId: string;
  externalId: string;
  paymentUrl: string;
  casheraUuid: string;
  amountMinor: number;
  peaches: number;
  feeRebate: number;
  priceLine: string;
}> {
  if (!isCasheraTopupMethod(opts.method)) {
    throw new Error("Use createStreampayTopupPayment for StreamPay methods");
  }
  if (!casheraConfigured()) {
    throw new Error("Платежи ещё не настроены (нет ключей Cashera)");
  }
  if (!isActiveTopupMethod(opts.method)) {
    throw new Error("Этот способ оплаты недоступен.");
  }
  const peaches = Math.floor(opts.peaches);
  const packBonus = Math.max(0, Math.floor(opts.bonusPeaches || 0));
  const feeRebate = topupFeeRebatePeaches(peaches, opts.method);
  const bonus = packBonus + feeRebate;
  if (peaches < TG_MIN_TOPUP_PEACHES) {
    throw new Error(`Минимум ${TG_MIN_TOPUP_PEACHES}₽`);
  }
  if (peaches > TG_MAX_TOPUP_PEACHES) {
    throw new Error(`Максимум за раз — ${TG_MAX_TOPUP_PEACHES}₽`);
  }

  const rub = peachesToRub(peaches);
  const amountMinor = rubToMinor(rub);
  const creditTotal = peaches + bonus;

  const order = await prisma.paymentOrder.create({
    data: {
      externalId: `pb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      userId: opts.userId,
      peaches: creditTotal,
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
          ? `PeachBitch top-up ${peaches} RUB`
          : `Пополнение PeachBitch ${peaches}₽`,
      metadata: {
        userId: opts.userId,
        peaches,
        packBonus,
        feeRebate,
        creditPeaches: creditTotal,
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

    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId: opts.userId,
      eventKey: "bot.topup.order_created",
      meta: {
        orderId: order.id,
        method: opts.method,
        peaches,
        packBonus,
        amountMinor,
        provider: "cashera",
      },
    });

    return {
      orderId: order.id,
      externalId: order.externalId,
      paymentUrl: String(tx.payment_url),
      casheraUuid: tx.uuid,
      amountMinor,
      peaches: creditTotal,
      feeRebate,
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
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId: opts.userId,
      eventKey: "bot.topup.order_failed",
      meta: {
        orderId: order.id,
        method: opts.method,
        peaches,
        error: e instanceof Error ? e.message : String(e),
        provider: "cashera",
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
