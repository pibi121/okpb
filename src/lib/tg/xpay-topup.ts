/**
 * Kazakhstan / Uzbekistan card top-ups via XPayConnect.
 * Balance stays in rubles. The pay form is local currency plus the 10% fee.
 */
import { prisma } from "@/lib/db";
import { getCbrRates } from "@/lib/fx/cbr";
import { peachesToUsdt } from "@/lib/tg-pricing";
import { rubToMinor } from "@/lib/cashera";
import { creditPeaches } from "@/lib/tg/wallet";
import { topupFeeRebatePeaches } from "@/lib/tg/topup-payments";
import {
  formatGroupedInt,
  quoteLocalTopup,
  type LocalTopupQuote,
} from "@/lib/tg/xpay-quote";
import {
  createXpayPayin,
  type XpayCabinetId,
} from "@/lib/xpay";
import type { TgLocale } from "@/lib/tg/i18n";

export const XPAY_TOPUP_METHODS = ["kz_card", "uz_card"] as const;
export type XpayTopupMethod = (typeof XPAY_TOPUP_METHODS)[number];

type CabinetSpec = {
  cabinet: XpayCabinetId;
  currency: "KZT" | "UZS";
  type: string;
  minLocal: number;
  maxLocal: number;
  feeRate: number;
  /** Genitive: «с карты Казахстана». */
  countryRu: string;
  countryEn: string;
  /** «тенге» / «сум». */
  unitRu: string;
  unitEn: string;
};

const CABINETS: Record<XpayTopupMethod, CabinetSpec> = {
  kz_card: {
    cabinet: "kz",
    currency: "KZT",
    type: "sngs",
    minLocal: 1_000,
    maxLocal: 900_000,
    feeRate: 0.1,
    countryRu: "Казахстана",
    countryEn: "Kazakhstan",
    unitRu: "тенге",
    unitEn: "tenge",
  },
  uz_card: {
    cabinet: "uz",
    currency: "UZS",
    type: "card",
    minLocal: 50_000,
    maxLocal: 20_000_000,
    feeRate: 0.1,
    countryRu: "Узбекистана",
    countryEn: "Uzbekistan",
    unitRu: "сум",
    unitEn: "sum",
  },
};

export function isXpayTopupMethod(method: string): method is XpayTopupMethod {
  return method === "kz_card" || method === "uz_card";
}

export type XpayOrderMeta = {
  provider: "xpay";
  cabinet: XpayCabinetId;
  method: XpayTopupMethod;
  localCurrency: "KZT" | "UZS";
  localFace: number;
  localCharge: number;
  faceRub: number;
  selectedRub: number;
  bumped: boolean;
  payLine: string;
  xpayId: string;
};

export function parseXpayOrderMeta(raw: string): XpayOrderMeta | null {
  try {
    const v = JSON.parse(raw) as Partial<XpayOrderMeta>;
    if (v?.provider !== "xpay") return null;
    if (v.method !== "kz_card" && v.method !== "uz_card") return null;
    if (!Number.isFinite(v.localCharge) || !Number.isFinite(v.localFace)) return null;
    return v as XpayOrderMeta;
  } catch {
    return null;
  }
}

function payLine(quote: LocalTopupQuote, currency: string): string {
  const usd = peachesToUsdt(quote.faceRub);
  return `${formatGroupedInt(quote.localFace)} ${currency} (≈ ${quote.faceRub}₽, $${usd})`;
}

export function xpayPayCaption(opts: {
  method: XpayTopupMethod;
  quote: LocalTopupQuote;
  locale: TgLocale;
}): { html: string; notice: string | null; payLine: string } {
  const spec = CABINETS[opts.method];
  const line = payLine(opts.quote, spec.currency);
  const minLocal = `${formatGroupedInt(spec.minLocal)} ${opts.locale === "en" ? spec.unitEn : spec.unitRu}`;
  const ru = opts.locale !== "en";
  const warn = opts.quote.bumped
    ? ru
      ? `❗️Сейчас минимальная сумма для пополнения с карты ${spec.countryRu} от ${minLocal}\n\n`
      : `❗️Minimum card top-up for ${spec.countryEn} is ${minLocal}\n\n`
    : "";
  const html = ru
    ? `${warn}К оплате: <b>${line}</b>\n\nОплата картой ${spec.countryRu}: открой форму → переведи указанную сумму.\n\nЕсли страница не загружается — отключи VPN или попробуй открыть её через Wi-Fi.\n\n⚠️ Сумма комиссии будет зачислена на твой баланс!`
    : `${warn}To pay: <b>${line}</b>\n\nCard payment in ${spec.countryEn}: open the form → transfer the amount.\n\nIf the page does not load, turn VPN off or try Wi-Fi.\n\n⚠️ The fee is credited back to your balance!`;
  const notice = opts.quote.bumped
    ? ru
      ? `Сейчас минимальная сумма для пополнения с карты ${spec.countryRu} от ${minLocal}. К оплате: ${line}. Комиссия вернётся на баланс.`
      : `Minimum for ${spec.countryEn} is ${minLocal}. To pay: ${line}. The fee is credited back to your balance.`
    : null;
  return { html, notice, payLine: line };
}

export async function createXpayTopupPayment(opts: {
  userId: string;
  peaches: number;
  bonusPeaches?: number;
  method: XpayTopupMethod;
  locale?: TgLocale;
}): Promise<{
  orderId: string;
  externalId: string;
  paymentUrl: string;
  amountMinor: number;
  peaches: number;
  feeRebate: number;
  priceLine: string;
  captionHtml: string;
  notice: string | null;
  bumped: boolean;
  faceRub: number;
  selectedRub: number;
}> {
  const spec = CABINETS[opts.method];
  const { xpayCabinetConfigured } = await import("@/lib/xpay");
  if (!xpayCabinetConfigured(spec.cabinet)) {
    throw new Error("Этот способ оплаты ещё не настроен.");
  }
  let rates;
  try {
    rates = await getCbrRates();
  } catch (e) {
    console.error("[xpay] cbr rate failed", e instanceof Error ? e.message : "cbr");
    throw new Error("Не удалось получить курс. Попробуй ещё раз через минуту.");
  }
  const rubPerLocal = spec.currency === "KZT" ? rates.rubPerKzt : rates.rubPerUzs;
  let quote: LocalTopupQuote;
  try {
    quote = quoteLocalTopup({
      selectedRub: opts.peaches,
      rubPerLocal,
      minLocal: spec.minLocal,
      maxLocal: spec.maxLocal,
      feeRate: spec.feeRate,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "amount_above_max") {
      throw new Error("Сумма выше лимита этого способа. Выбери меньше.");
    }
    throw new Error("Не удалось посчитать сумму. Попробуй ещё раз.");
  }

  const locale = opts.locale === "en" ? "en" : "ru";
  const copy = xpayPayCaption({ method: opts.method, quote, locale });
  const packBonus = Math.max(0, Math.floor(opts.bonusPeaches || 0));
  const feeRebate = topupFeeRebatePeaches(quote.faceRub, opts.method);
  const creditTotal = quote.faceRub + packBonus + feeRebate;
  const amountMinor = rubToMinor(quote.faceRub);

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

  const metaBase: XpayOrderMeta = {
    provider: "xpay",
    cabinet: spec.cabinet,
    method: opts.method,
    localCurrency: spec.currency,
    localFace: quote.localFace,
    localCharge: quote.localCharge,
    faceRub: quote.faceRub,
    selectedRub: quote.selectedRub,
    bumped: quote.bumped,
    payLine: copy.payLine,
    xpayId: "",
  };

  try {
    const remote = await createXpayPayin({
      cabinet: spec.cabinet,
      orderId: order.externalId,
      amount: quote.localCharge,
      type: spec.type,
      currency: spec.currency,
      clientId: opts.userId,
    });
    const meta: XpayOrderMeta = { ...metaBase, xpayId: remote.id || "" };
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        casheraUuid: remote.id || "",
        paymentUrl: remote.formUrl,
        status: remote.status || "pending",
        rawStatusJson: JSON.stringify(meta).slice(0, 8000),
      },
    });
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId: opts.userId,
      eventKey: "bot.topup.order_created",
      meta: {
        orderId: order.id,
        method: opts.method,
        peaches: quote.faceRub,
        packBonus,
        amountMinor,
        localFace: quote.localFace,
        localCharge: quote.localCharge,
        currency: spec.currency,
        bumped: quote.bumped,
      },
    });
    return {
      orderId: order.id,
      externalId: order.externalId,
      paymentUrl: remote.formUrl,
      amountMinor,
      peaches: creditTotal,
      feeRebate,
      priceLine: copy.payLine,
      captionHtml: copy.html,
      notice: copy.notice,
      bumped: quote.bumped,
      faceRub: quote.faceRub,
      selectedRub: quote.selectedRub,
    };
  } catch (e) {
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        rawStatusJson: JSON.stringify({
          ...metaBase,
          error: e instanceof Error ? e.message : "xpay_create_failed",
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
        peaches: quote.faceRub,
        error: e instanceof Error ? e.message : "xpay_create_failed",
      },
    });
    throw e;
  }
}

function paidAmountOk(got: number, meta: XpayOrderMeta): boolean {
  if (!Number.isFinite(got) || got <= 0) return false;
  const hi = meta.localCharge + Math.max(100, meta.localCharge * 0.05);
  return got + 0.001 >= meta.localFace && got <= hi + 0.001;
}

export async function fulfillXpayTopup(opts: {
  externalId: string;
  event: string;
  amount: number;
  xpayId: string;
}): Promise<{ credited: boolean; peaches: number; userId: string | null; status: string }> {
  const order = await prisma.paymentOrder.findUnique({
    where: { externalId: opts.externalId },
  });
  if (!order || !isXpayTopupMethod(order.paymentMethod)) {
    console.warn("[xpay] unknown order", opts.externalId);
    return { credited: false, peaches: 0, userId: null, status: "missing" };
  }
  if (order.creditedAt) {
    return {
      credited: false,
      peaches: order.peaches,
      userId: order.userId,
      status: "paid",
    };
  }

  const event = opts.event;
  if (event === "cancelled") {
    if (order.status !== "pending") {
      return {
        credited: false,
        peaches: order.peaches,
        userId: order.userId,
        status: order.status,
      };
    }
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: "canceled" },
    });
    return {
      credited: false,
      peaches: order.peaches,
      userId: order.userId,
      status: "canceled",
    };
  }
  if (event !== "success") {
    return {
      credited: false,
      peaches: order.peaches,
      userId: order.userId,
      status: order.status,
    };
  }

  const meta = parseXpayOrderMeta(order.rawStatusJson);
  if (!meta || !paidAmountOk(opts.amount, meta)) {
    console.error("[xpay] amount mismatch", opts.externalId, {
      got: opts.amount,
      face: meta?.localFace,
      charge: meta?.localCharge,
    });
    return {
      credited: false,
      peaches: order.peaches,
      userId: order.userId,
      status: "mismatch",
    };
  }

  await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: "paid",
      paidAt: new Date(),
      ...(opts.xpayId ? { casheraUuid: opts.xpayId } : {}),
    },
  });

  const locked = await prisma.paymentOrder.updateMany({
    where: { id: order.id, creditedAt: null, status: "paid" },
    data: { creditedAt: new Date() },
  });
  if (locked.count === 0) {
    return {
      credited: false,
      peaches: order.peaches,
      userId: order.userId,
      status: "paid",
    };
  }

  await creditPeaches(order.userId, order.peaches, "tg_topup_xpay", {
    orderId: order.id,
    externalId: order.externalId,
    paymentMethod: order.paymentMethod,
    amountMinor: order.amountMinor,
    localCharge: meta.localCharge,
    localCurrency: meta.localCurrency,
  });

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
      provider: "xpay",
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

  return {
    credited: true,
    peaches: order.peaches,
    userId: order.userId,
    status: "paid",
  };
}
