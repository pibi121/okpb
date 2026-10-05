import { NextRequest, NextResponse } from "next/server";
import { verifyXpayWebhook, type XpayCabinetId } from "@/lib/xpay";
import { fulfillXpayTopup } from "@/lib/tg/xpay-topup";
import { prisma } from "@/lib/db";
import { tFormat, type TgLocale } from "@/lib/tg/i18n";
import { tgNotifyUserOnLiveBots } from "@/lib/tg/notify-user";
import { formatNotice } from "@/lib/ops/notices";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { userOnFunnelV2 } from "@/lib/tg/funnel-v2/mode";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ cabinet: string }> };

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function notifyCredited(userId: string, peaches: number, externalId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true, balancePeaches: true },
    });
    const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
    const text = tFormat("topup_paid", locale, {
      n: peaches,
      balance: user?.balancePeaches ?? peaches,
    });
    await tgNotifyUserOnLiveBots({ userId, text, allLive: true });
    void import("@/lib/tg/funnel-v2/faststart")
      .then(({ afterFunnelV2TopupCredited }) =>
        afterFunnelV2TopupCredited({ userId, peaches }),
      )
      .catch((e) => console.error("[xpay] fv2 after topup:", e));
  } catch (e) {
    console.error("[xpay] notify user failed:", e);
    void import("@/lib/ops/errors")
      .then(({ reportOpsError }) =>
        reportOpsError({
          kind: "payment",
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
          userId,
          stage: "xpay_notify",
          meta: { peaches, externalId },
        }),
      )
      .catch(() => undefined);
  }
}

async function notifyFailed(userId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
    const notice =
      (await formatNotice("payment_fail", locale)) ||
      (locale === "en"
        ? "The payment didn't go through. Nothing was charged."
        : "Платёж не дошёл. Деньги не списались. Попробуй ещё раз или напиши в поддержку.");
    const onFv2 = user ? await userOnFunnelV2(user) : false;
    await tgNotifyUserOnLiveBots({
      userId,
      text: notice,
      allLive: true,
      extra: {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: locale === "en" ? "Top up again" : "Пополнить снова",
                callback_data: onFv2 ? FV2.topup : "tu:open",
              },
            ],
          ],
        },
      },
    });
  } catch (e) {
    console.error("[xpay] payment_fail notify:", e);
  }
}

/**
 * XPay webhook. Signature is SHA-256 of `apiKey|rawBody` in `x-api-key`.
 * Cabinet in the path picks which key to check. Keys are never logged.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { cabinet: rawCabinet } = await ctx.params;
  if (rawCabinet !== "kz" && rawCabinet !== "uz") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const cabinet = rawCabinet as XpayCabinetId;
  const rawBody = await req.text();
  if (!verifyXpayWebhook(cabinet, rawBody, req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = String(body.event || "");
  const status = String(body.status || "");
  const externalId = String(body.order_id || "").trim();
  const xpayId = String(body.id || "").trim();
  const amount = Number(body.amount);
  console.info("[xpay] webhook", { cabinet, event, status, externalId });

  if (!externalId) {
    return NextResponse.json({ ok: true, skipped: "no order_id" });
  }

  if (event === "extra_check") {
    const extra = body.extra_check as { message?: string } | undefined;
    const message = String(extra?.message || "").trim().slice(0, 500);
    const order = await prisma.paymentOrder.findUnique({
      where: { externalId },
      select: { userId: true },
    });
    if (order && message) {
      await tgNotifyUserOnLiveBots({
        userId: order.userId,
        text: escHtml(message),
        allLive: true,
      }).catch((e) => console.error("[xpay] extra_check notify:", e));
    }
    return NextResponse.json({ ok: true, event });
  }

  const kind =
    event === "success" || event === "cancelled"
      ? event
      : status === "success"
        ? "success"
        : "";
  if (!kind) {
    return NextResponse.json({ ok: true, event, status, skipped: "ignore" });
  }

  const result = await fulfillXpayTopup({
    externalId,
    event: kind,
    amount,
    xpayId,
  });

  if (result.credited && result.userId && result.peaches) {
    await notifyCredited(result.userId, result.peaches, externalId);
  } else if (result.userId && result.status === "canceled") {
    await notifyFailed(result.userId);
  }

  return NextResponse.json({
    ok: true,
    event: kind,
    credited: result.credited,
  });
}
