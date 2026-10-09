import { NextRequest, NextResponse } from "next/server";
import { verifyStreampayCallback } from "@/lib/streampay";
import { fulfillStreampayTopup } from "@/lib/tg/streampay-topup";
import { prisma } from "@/lib/db";
import { tFormat, type TgLocale } from "@/lib/tg/i18n";
import { tgNotifyUserOnLiveBots } from "@/lib/tg/notify-user";
import { formatNotice } from "@/lib/ops/notices";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { userOnFunnelV2 } from "@/lib/tg/funnel-v2/mode";

export const runtime = "nodejs";

/**
 * StreamPay callback is GET with query params + `signature` header.
 * Credit only on status=success (see streampay-topup fulfill).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    query[k] = v;
  }

  const signature =
    req.headers.get("signature") || req.headers.get("Signature");
  if (!verifyStreampayCallback(query, signature)) {
    console.warn("[streampay] bad signature", {
      keys: Object.keys(query).sort(),
    });
    return new NextResponse("forbidden", { status: 403 });
  }

  const externalId = String(query.external_id || "").trim();
  const status = String(query.status || "").trim().toLowerCase();
  const invoiceId = String(query.invoice || "").trim();

  console.info("[streampay] callback", {
    externalId,
    status,
    invoiceId,
    amount: query.amount,
    system_amount: query.system_amount,
    currency: query.currency,
  });

  if (!externalId) {
    return new NextResponse("ok", { status: 200 });
  }

  const result = await fulfillStreampayTopup({
    externalId,
    status,
    invoiceId,
    amount: Number(query.amount),
    payedAmount: Number(query.payed_amount),
    systemAmount: Number(query.system_amount),
    rate: Number(query.rate),
    currency: query.currency,
    raw: query,
  });

  if (result.credited && result.userId && result.peaches) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { locale: true, balancePeaches: true },
      });
      const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
      const text = tFormat("topup_paid", locale, {
        n: result.peaches,
        balance: user?.balancePeaches ?? result.peaches,
      });
      await tgNotifyUserOnLiveBots({
        userId: result.userId,
        text,
        allLive: true,
      });
      void import("@/lib/tg/funnel-v2/faststart")
        .then(({ afterFunnelV2TopupCredited }) =>
          afterFunnelV2TopupCredited({
            userId: result.userId!,
            peaches: result.peaches!,
          }),
        )
        .catch((e) => console.error("[streampay] fv2 after topup:", e));
    } catch (e) {
      console.error("[streampay] notify user failed:", e);
      void import("@/lib/ops/errors")
        .then(({ reportOpsError }) =>
          reportOpsError({
            kind: "payment",
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
            userId: result.userId,
            stage: "streampay_notify",
            meta: { peaches: result.peaches, externalId },
          }),
        )
        .catch(() => undefined);
    }
  } else if (result.refunded && result.userId && result.peaches) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { locale: true, balancePeaches: true },
      });
      const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
      const text = tFormat("topup_refunded", locale, {
        n: result.peaches,
        balance:
          result.balanceAfter ?? user?.balancePeaches ?? 0,
      });
      await tgNotifyUserOnLiveBots({
        userId: result.userId,
        text,
        allLive: true,
      });
    } catch (e) {
      console.error("[streampay] refund notify user failed:", e);
    }
  } else if (
    result.userId &&
    /^(cancel|overdue|refund)$/.test(status) &&
    !result.credited &&
    !result.refunded
  ) {
    // Only notify fail if never credited (cancel-after-success already ignored).
    const order = await prisma.paymentOrder.findUnique({
      where: { externalId },
      select: { creditedAt: true },
    });
    if (!order?.creditedAt) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: result.userId },
        });
        const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
        const notice =
          (await formatNotice("payment_fail", locale)) ||
          (locale === "en"
            ? "The payment didn't go through. Nothing was charged."
            : "Платёж не дошёл. Деньги не списались. Попробуй ещё раз или напиши в поддержку.");
        const onFv2 = user ? await userOnFunnelV2(user) : false;
        await tgNotifyUserOnLiveBots({
          userId: result.userId,
          text: notice,
          allLive: true,
          extra: {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      locale === "en" ? "Top up again" : "Пополнить снова",
                    callback_data: onFv2 ? FV2.topup : "tu:open",
                  },
                ],
              ],
            },
          },
        });
      } catch (e) {
        console.error("[streampay] payment_fail notify:", e);
      }
    }
  }

  // StreamPay expects a quick 2xx body.
  return new NextResponse("ok", { status: 200 });
}
