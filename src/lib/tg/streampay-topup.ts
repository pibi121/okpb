/**
 * StreamPay top-ups: RUB SBP reserve + KZ/BY/UA cards.
 * Invoice in local currency (payment_type=1), converted from RUB face.
 * Fee (~4.5%) is paid by the customer on StreamPay; we rebate as peaches.
 */
import { prisma } from "@/lib/db";
import { rubToMinor } from "@/lib/cashera";
import { getCbrRates } from "@/lib/fx/cbr";
import { peachesToUsdt } from "@/lib/tg-pricing";
import { creditPeaches, debitPeaches } from "@/lib/tg/wallet";
import { topupFeeRebatePeaches } from "@/lib/tg/topup-payments";
import {
  formatLocalAmount,
  quoteLocalTopup,
  type LocalTopupQuote,
} from "@/lib/tg/local-topup-quote";
import {
  createStreampayInvoice,
  streampayConfigured,
} from "@/lib/streampay";
import type { TgLocale } from "@/lib/tg/i18n";

export const STREAMPAY_TOPUP_METHODS = [
  "sp_sbp",
  "sp_kz",
  "sp_by",
  "sp_ua",
] as const;

export type StreampayTopupMethod = (typeof STREAMPAY_TOPUP_METHODS)[number];

export type StreampayCurrency = "RUB" | "KZT" | "BYN" | "UAH";

type MethodSpec = {
  currency: StreampayCurrency;
  /** StreamPay cabinet limits from /api/payment/currencies */
  minLocal: number;
  maxLocal: number;
  precision: number;
  /** Fixed RUB/local when currency is RUB; else from CBR. */
  rubPerLocal?: number;
  countryRu: string;
  countryEn: string;
  unitRu: string;
  unitEn: string;
  kind: "sbp" | "card";
};

const SPECS: Record<StreampayTopupMethod, MethodSpec> = {
  sp_sbp: {
    currency: "RUB",
    minLocal: 100,
    maxLocal: 150_000,
    precision: 2,
    rubPerLocal: 1,
    countryRu: "РФ",
    countryEn: "Russia",
    unitRu: "₽",
    unitEn: "RUB",
    kind: "sbp",
  },
  sp_kz: {
    currency: "KZT",
    minLocal: 1000,
    maxLocal: 80_000,
    precision: 0,
    countryRu: "Казахстана",
    countryEn: "Kazakhstan",
    unitRu: "тенге",
    unitEn: "tenge",
    kind: "card",
  },
  sp_by: {
    currency: "BYN",
    minLocal: 10,
    maxLocal: 999,
    precision: 1,
    countryRu: "Беларуси",
    countryEn: "Belarus",
    unitRu: "BYN",
    unitEn: "BYN",
    kind: "card",
  },
  sp_ua: {
    currency: "UAH",
    minLocal: 300,
    maxLocal: 150_000,
    precision: 0,
    countryRu: "Украины",
    countryEn: "Ukraine",
    unitRu: "грн",
    unitEn: "UAH",
    kind: "card",
  },
};

export function isStreampayTopupMethod(
  method: string,
): method is StreampayTopupMethod {
  return (STREAMPAY_TOPUP_METHODS as readonly string[]).includes(method);
}

export type StreampayOrderMeta = {
  provider: "streampay";
  method: StreampayTopupMethod;
  currency: StreampayCurrency;
  localFace: number;
  faceRub: number;
  selectedRub: number;
  bumped: boolean;
  packBonus: number;
  feeRebate: number;
  payLine: string;
  invoiceId: string;
};

export function parseStreampayOrderMeta(raw: string): StreampayOrderMeta | null {
  try {
    const v = JSON.parse(raw) as Partial<StreampayOrderMeta>;
    if (v?.provider !== "streampay") return null;
    if (!v.method || !isStreampayTopupMethod(v.method)) return null;
    if (!Number.isFinite(v.localFace) || !Number.isFinite(v.faceRub)) return null;
    return v as StreampayOrderMeta;
  } catch {
    return null;
  }
}

async function rubPerLocalFor(method: StreampayTopupMethod): Promise<number> {
  const spec = SPECS[method];
  if (spec.rubPerLocal != null) return spec.rubPerLocal;
  const rates = await getCbrRates();
  if (method === "sp_kz") return rates.rubPerKzt;
  if (method === "sp_by") return rates.rubPerByn;
  if (method === "sp_ua") return rates.rubPerUah;
  throw new Error("bad_method");
}

function payLine(quote: LocalTopupQuote, spec: MethodSpec): string {
  const usd = peachesToUsdt(quote.faceRub);
  if (spec.currency === "RUB") {
    return `${quote.faceRub} ₽ (≈ $${usd})`;
  }
  const local = formatLocalAmount(quote.localFace, spec.precision);
  return `${local} ${spec.currency} (≈ ${quote.faceRub}₽, $${usd})`;
}

export function streampayPayCaption(opts: {
  method: StreampayTopupMethod;
  quote: LocalTopupQuote;
  locale: TgLocale;
}): { html: string; notice: string | null; payLine: string } {
  const spec = SPECS[opts.method];
  const line = payLine(opts.quote, spec);
  const ru = opts.locale !== "en";
  const minLocal = `${formatLocalAmount(spec.minLocal, spec.precision)} ${
    ru ? spec.unitRu : spec.unitEn
  }`;
  const warn = opts.quote.bumped
    ? ru
      ? `❗️Сейчас минимальная сумма для этого способа от ${minLocal}\n\n`
      : `❗️Minimum for this method is ${minLocal}\n\n`
    : "";
  const how =
    spec.kind === "sbp"
      ? ru
        ? `Оплата через СБП (резерв): открой форму → подтверди перевод в банковском приложении.`
        : `SBP (backup): open the form → confirm the transfer in your bank app.`
      : ru
        ? `Оплата картой ${spec.countryRu}: открой форму → переведи указанную сумму.`
        : `Card payment (${spec.countryEn}): open the form → transfer the amount.`;
  const html = ru
    ? `${warn}К оплате: <b>${line}</b>\n\n${how}\n\nЕсли страница не загружается — отключи VPN или попробуй открыть её через Wi-Fi.\n\n⚠️ Сумма комиссии будет зачислена на твой баланс!`
    : `${warn}To pay: <b>${line}</b>\n\n${how}\n\nIf the page does not load, turn VPN off or try Wi-Fi.\n\n⚠️ The fee is credited back to your balance!`;
  const notice = opts.quote.bumped
    ? ru
      ? `Минимальная сумма для этого способа от ${minLocal}. К оплате: ${line}. Комиссия вернётся на баланс.`
      : `Minimum is ${minLocal}. To pay: ${line}. The fee is credited back to your balance.`
    : null;
  return { html, notice, payLine: line };
}

export async function createStreampayTopupPayment(opts: {
  userId: string;
  peaches: number;
  bonusPeaches?: number;
  method: StreampayTopupMethod;
  locale?: TgLocale;
}): Promise<{
  orderId: string;
  externalId: string;
  paymentUrl: string;
  amountMinor: number;
  peaches: number;
  feeRebate: number;
  priceLine: string;
  quote: LocalTopupQuote;
  captionHtml: string;
}> {
  if (!streampayConfigured()) {
    throw new Error("Платежи StreamPay ещё не настроены");
  }
  if (!isStreampayTopupMethod(opts.method)) {
    throw new Error("Этот способ оплаты недоступен.");
  }

  const spec = SPECS[opts.method];
  const selectedRub = Math.floor(opts.peaches);
  const packBonus = Math.max(0, Math.floor(opts.bonusPeaches || 0));
  const rubPerLocal = await rubPerLocalFor(opts.method);

  let quote: LocalTopupQuote;
  try {
    quote = quoteLocalTopup({
      selectedRub,
      rubPerLocal,
      minLocal: spec.minLocal,
      maxLocal: spec.maxLocal,
      precision: spec.precision,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "amount_above_max") {
      throw new Error(
        opts.locale === "en"
          ? "Amount is above the limit for this method. Choose a smaller pack."
          : "Сумма выше лимита этого способа. Выбери меньший пакет.",
      );
    }
    throw e;
  }

  const feeRebate = topupFeeRebatePeaches(quote.faceRub, opts.method);
  const creditTotal = quote.faceRub + packBonus + feeRebate;
  const amountMinor = rubToMinor(quote.faceRub);
  const copy = streampayPayCaption({
    method: opts.method,
    quote,
    locale: opts.locale === "en" ? "en" : "ru",
  });

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

  const metaBase: StreampayOrderMeta = {
    provider: "streampay",
    method: opts.method,
    currency: spec.currency,
    localFace: quote.localFace,
    faceRub: quote.faceRub,
    selectedRub: quote.selectedRub,
    bumped: quote.bumped,
    packBonus,
    feeRebate,
    payLine: copy.payLine,
    invoiceId: "",
  };

  try {
    const remote = await createStreampayInvoice({
      customer: opts.userId,
      externalId: order.externalId,
      description:
        opts.locale === "en"
          ? `PeachBitch top-up ${quote.faceRub} RUB`
          : `Пополнение PeachBitch ${quote.faceRub}₽`,
      paymentType: 1,
      amount: quote.localFace,
      currency: spec.currency,
      lang: opts.locale === "en" ? "en" : "ru",
    });
    const meta: StreampayOrderMeta = {
      ...metaBase,
      invoiceId: remote.invoice,
    };
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        casheraUuid: remote.invoice,
        paymentUrl: remote.payUrl,
        status: "pending",
        rawStatusJson: JSON.stringify({
          ...meta,
          create: remote.raw,
        }).slice(0, 8000),
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
        currency: spec.currency,
        provider: "streampay",
        bumped: quote.bumped,
      },
    });

    return {
      orderId: order.id,
      externalId: order.externalId,
      paymentUrl: remote.payUrl,
      amountMinor,
      peaches: creditTotal,
      feeRebate,
      priceLine: copy.payLine,
      quote,
      captionHtml: copy.html,
    };
  } catch (e) {
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        rawStatusJson: JSON.stringify({
          ...metaBase,
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
        peaches: quote.faceRub,
        error: e instanceof Error ? e.message : String(e),
        provider: "streampay",
      },
    });
    throw e;
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * StreamPay callback fulfill. Credit only on `success`.
 * After success, ignore later `cancel`. On amount recreate, recompute face from
 * callback fields (prefer system_amount×rate for RUB; else local→RUB via CBR).
 */
export async function fulfillStreampayTopup(opts: {
  externalId: string;
  status: string;
  invoiceId?: string;
  amount?: number;
  payedAmount?: number;
  systemAmount?: number;
  rate?: number;
  currency?: string;
  raw: Record<string, string>;
}): Promise<{
  credited: boolean;
  /** True when we clawed back a previously credited topup (StreamPay refund). */
  refunded?: boolean;
  peaches?: number;
  userId?: string;
  status: string;
  balanceAfter?: number;
}> {
  const order = await prisma.paymentOrder.findUnique({
    where: { externalId: opts.externalId },
  });
  if (!order) {
    console.warn("[streampay] unknown external_id", opts.externalId);
    return { credited: false, status: opts.status };
  }

  const status = String(opts.status || "").toLowerCase();
  const metaRaw = (() => {
    try {
      return JSON.parse(order.rawStatusJson || "{}") as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  const meta = parseStreampayOrderMeta(order.rawStatusJson) || null;

  // After success — ignore cancel (StreamPay recreate race).
  if (
    (status === "cancel" || status === "overdue") &&
    (order.creditedAt ||
      order.status === "success" ||
      order.status === "paid")
  ) {
    return {
      credited: false,
      peaches: order.peaches,
      userId: order.userId,
      status: order.status,
    };
  }

  // Refund after credit: claw back peaches (balance may go negative).
  if (status === "refund") {
    if (metaRaw.streampayRefundedAt) {
      return {
        credited: false,
        refunded: false,
        peaches: order.peaches,
        userId: order.userId,
        status: "refund",
      };
    }

    if (!order.creditedAt || order.peaches <= 0) {
      await prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: "refund",
          casheraUuid: opts.invoiceId || order.casheraUuid,
          rawStatusJson: JSON.stringify({
            ...metaRaw,
            ...(meta || {}),
            callback: opts.raw,
            at: new Date().toISOString(),
          }).slice(0, 8000),
        },
      });
      return {
        credited: false,
        refunded: false,
        peaches: order.peaches,
        userId: order.userId,
        status: "refund",
      };
    }

    // Lock: only one clawback (idempotent on repeated refund callbacks).
    const locked = await prisma.paymentOrder.updateMany({
      where: {
        id: order.id,
        creditedAt: { not: null },
        NOT: { rawStatusJson: { contains: '"streampayRefundedAt"' } },
      },
      data: {
        status: "refund",
        casheraUuid: opts.invoiceId || order.casheraUuid,
        rawStatusJson: JSON.stringify({
          ...metaRaw,
          ...(meta || {}),
          callback: opts.raw,
          streampayRefundedAt: new Date().toISOString(),
          streampayRefundPeaches: order.peaches,
          at: new Date().toISOString(),
        }).slice(0, 8000),
      },
    });
    if (locked.count === 0) {
      return {
        credited: false,
        refunded: false,
        peaches: order.peaches,
        userId: order.userId,
        status: "refund",
      };
    }

    const claw = await debitPeaches(
      order.userId,
      order.peaches,
      "tg_topup_streampay_refund",
      {
        orderId: order.id,
        externalId: order.externalId,
        invoiceId: opts.invoiceId || order.casheraUuid,
        paymentMethod: order.paymentMethod,
      },
      { allowNegative: true },
    );
    const balanceAfter = claw.balance;

    let partnerClawback = 0;
    try {
      const { clawbackPartnerCommission } = await import(
        "@/lib/tg/partner-program"
      );
      const pc = await clawbackPartnerCommission({
        referredUserId: order.userId,
        grossPeaches: order.peaches,
        kind: "topup",
      });
      partnerClawback = pc?.amount ?? 0;
    } catch (e) {
      console.error("[streampay] partner commission clawback:", e);
    }

    void import("@/lib/ops/ops-telegram")
      .then(({ notifyOpsPaymentRefund }) =>
        notifyOpsPaymentRefund({
          userId: order.userId,
          peaches: order.peaches,
          amountMinor: order.amountMinor,
          method: order.paymentMethod,
          balanceAfter,
          currency: "RUB",
          provider: "StreamPay",
          partnerClawback,
        }),
      )
      .catch(() => undefined);

    console.info("[streampay] refund clawback", {
      externalId: order.externalId,
      peaches: order.peaches,
      balanceAfter,
      partnerClawback,
    });

    return {
      credited: false,
      refunded: true,
      peaches: order.peaches,
      userId: order.userId,
      status: "refund",
      balanceAfter,
    };
  }

  await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status,
      casheraUuid: opts.invoiceId || order.casheraUuid,
      paidAt:
        status === "success" || status === "paid"
          ? order.paidAt || new Date()
          : order.paidAt,
      rawStatusJson: JSON.stringify({
        ...metaRaw,
        ...(meta || {}),
        callback: opts.raw,
        at: new Date().toISOString(),
      }).slice(0, 8000),
    },
  });

  if (status !== "success") {
    return { credited: false, peaches: order.peaches, userId: order.userId, status };
  }

  if (order.creditedAt) {
    return { credited: false, peaches: order.peaches, userId: order.userId, status };
  }

  const packBonus = meta?.packBonus ?? 0;
  const expectedLocal = meta?.localFace ?? NaN;
  const gotLocal = num(opts.payedAmount ?? opts.amount);
  const systemAmount = num(opts.systemAmount);
  const rate = num(opts.rate);
  const currency = String(opts.currency || meta?.currency || "").toUpperCase();

  let faceRub = meta?.faceRub ?? Math.round(order.amountMinor / 100);
  const localDiffers =
    Number.isFinite(expectedLocal) &&
    Number.isFinite(gotLocal) &&
    expectedLocal > 0 &&
    Math.abs(gotLocal - expectedLocal) / expectedLocal > 0.02;

  if (localDiffers) {
    if (currency === "RUB" && Number.isFinite(gotLocal)) {
      faceRub = Math.max(1, Math.round(gotLocal));
    } else if (
      Number.isFinite(systemAmount) &&
      systemAmount > 0 &&
      Number.isFinite(rate) &&
      rate > 0 &&
      currency === "RUB"
    ) {
      faceRub = Math.max(1, Math.round(systemAmount * rate));
    } else if (Number.isFinite(gotLocal) && gotLocal > 0 && meta?.method) {
      try {
        const rpl = await rubPerLocalFor(meta.method);
        faceRub = Math.max(1, Math.ceil(gotLocal * rpl - 1e-8));
      } catch {
        /* keep faceRub */
      }
    }
  }

  const feeRebate = topupFeeRebatePeaches(faceRub, order.paymentMethod);
  const creditTotal = faceRub + packBonus + feeRebate;
  const amountMinor = rubToMinor(faceRub);

  if (creditTotal !== order.peaches || amountMinor !== order.amountMinor) {
    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        peaches: creditTotal,
        amountMinor,
        rawStatusJson: JSON.stringify({
          ...(meta || {}),
          callback: opts.raw,
          adjustedFaceRub: faceRub,
          adjustedCredit: creditTotal,
          at: new Date().toISOString(),
        }).slice(0, 8000),
      },
    });
  }

  const locked = await prisma.paymentOrder.updateMany({
    where: { id: order.id, creditedAt: null },
    data: { creditedAt: new Date(), status: "success" },
  });
  if (locked.count === 0) {
    return { credited: false, peaches: creditTotal, userId: order.userId, status };
  }

  await creditPeaches(order.userId, creditTotal, "tg_topup_streampay", {
    orderId: order.id,
    externalId: order.externalId,
    invoiceId: opts.invoiceId || order.casheraUuid,
    paymentMethod: order.paymentMethod,
    amountMinor,
    faceRub,
    systemAmount: Number.isFinite(systemAmount) ? systemAmount : undefined,
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
      amount: creditTotal,
      method: order.paymentMethod,
      provider: "streampay",
      faceRub,
    },
  });

  void import("@/lib/ops/ops-telegram")
    .then(({ notifyOpsPayment }) =>
      notifyOpsPayment({
        userId: order.userId,
        peaches: creditTotal,
        amountMinor,
        method: order.paymentMethod,
        currency: "RUB",
      }),
    )
    .catch(() => undefined);

  return {
    credited: true,
    peaches: creditTotal,
    userId: order.userId,
    status: "success",
  };
}
