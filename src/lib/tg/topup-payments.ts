/**
 * Peach top-ups via Cashera (SBP / crypto) and XPay cards (KZ / UZ).
 * Cashera card is not offered — that merchant has card disabled.
 */
import { prisma } from "@/lib/db";
import {
  casheraConfigured,
  createCasheraPayment,
  rubToMinor,
  type CasheraPaymentMethod,
  type CasheraTransaction,
} from "@/lib/cashera";
import { xpayCabinetConfigured } from "@/lib/xpay";
import {
  TG_MAX_TOPUP_PEACHES,
  TG_MIN_TOPUP_PEACHES,
  peachesToRub,
  peachesToUsdt,
} from "@/lib/tg-pricing";
import { creditPeaches } from "@/lib/tg/wallet";

export type TopupMethodId =
  | Exclude<CasheraPaymentMethod, "card">
  | "kz_card"
  | "uz_card";

/** Methods known to the product. CryptoBot stays hidden until Cashera path works. */
export const TOPUP_PAYMENT_METHODS: Array<{
  id: TopupMethodId;
  labelRu: string;
  labelEn: string;
  /** Telegram Bot API inline button style (primary/success/danger). */
  style: "primary" | "success" | "danger";
}> = [
  {
    id: "sbp",
    labelRu: "📲 СБП (для жителей РФ)",
    labelEn: "📲 SBP (for Russia)",
    style: "success",
  },
  {
    id: "crypto",
    labelRu: "🪙 Криптовалюта (USDT, BTC, ETH и т.д)",
    labelEn: "🪙 Crypto (USDT, BTC, ETH…)",
    style: "danger",
  },
  {
    id: "kz_card",
    labelRu: "Картой (Казахстан)",
    labelEn: "Card (Kazakhstan)",
    style: "primary",
  },
  {
    id: "uz_card",
    labelRu: "Картой (Узбекистан)",
    labelEn: "Card (Uzbekistan)",
    style: "primary",
  },
  // Hidden: CryptoBot not working in Cashera yet — re-add when ready:
  // { id: "cryptobot", labelRu: "💎 CryptoBot…", labelEn: "💎 CryptoBot…", style: "primary" },
];

/** Buttons actually rendered. KZ/UZ stay hidden until that cabinet key is set. */
export function visibleTopupMethods() {
  return TOPUP_PAYMENT_METHODS.filter((m) => {
    if (m.id === "kz_card") return xpayCabinetConfigured("kz");
    if (m.id === "uz_card") return xpayCabinetConfigured("uz");
    return true;
  });
}

export const TOPUP_ACTIVE_METHOD_IDS = TOPUP_PAYMENT_METHODS.map((m) => m.id);

/**
 * Fee rebate % credited back to the balance.
 * Cashera adds its fee on the form (fee_payer=customer).
 * XPay has no such switch: we gross up the form amount and rebate 10% here.
 */
export const TOPUP_FEE_REBATE_PCT: Record<TopupMethodId, number> = {
  sbp: 13,
  crypto: 3,
  cryptobot: 5,
  kz_card: 10,
  uz_card: 10,
};

/**
 * Peaches returned to cover payment-provider fee for the chosen method.
 */
export function topupFeeRebatePeaches(
  peaches: number,
  method: string,
): number {
  const pct = TOPUP_FEE_REBATE_PCT[method as keyof typeof TOPUP_FEE_REBATE_PCT];
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(0, Math.ceil((Math.floor(peaches) * pct) / 100));
}

export function isActiveTopupMethod(method: string): method is TopupMethodId {
  return (TOPUP_ACTIVE_METHOD_IDS as string[]).includes(method);
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
  method: CasheraPaymentMethod;
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
  if (!casheraConfigured()) {
    throw new Error("Платежи ещё не настроены (нет ключей Cashera)");
  }
  if (!isActiveTopupMethod(opts.method)) {
    throw new Error(
      "Этот способ оплаты недоступен. Выбери СБП или крипту.",
    );
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
