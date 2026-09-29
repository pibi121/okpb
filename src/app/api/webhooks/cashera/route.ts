import { NextRequest, NextResponse } from "next/server";
import { verifyCasheraWebhookHeaders } from "@/lib/cashera";
import { fulfillPaidTopup } from "@/lib/tg/topup-payments";
import { prisma } from "@/lib/db";
import { tFormat, type TgLocale } from "@/lib/tg/i18n";
import { tgNotifyUserOnLiveBots } from "@/lib/tg/notify-user";
import { formatNotice } from "@/lib/ops/notices";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { userOnFunnelV2 } from "@/lib/tg/funnel-v2/mode";

export const runtime = "nodejs";

/**
 * Cashera webhook — verify X-Api-Key + X-Secret, credit peaches on paid.
 * https://docs.cashera.cash/webhooks
 */
export async function POST(req: NextRequest) {
  const apiKeyHeader = req.headers.get("x-api-key");
  const secretHeader = req.headers.get("x-secret");
  if (!verifyCasheraWebhookHeaders({ apiKeyHeader, secretHeader })) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = String(body.event || "");
  if (event === "webhook.test") {
    return NextResponse.json({ ok: true, event });
  }

  const txRaw = (body.transaction || body) as Record<string, unknown>;
  const externalId = String(txRaw.external_id || "").trim();
  const status = String(txRaw.status || "").trim().toLowerCase();
  const uuid = String(txRaw.uuid || "").trim();

  if (!externalId) {
    return NextResponse.json({ ok: true, skipped: "no external_id" });
  }

  // Idempotency marker in raw json is enough; fulfillPaidTopup also guards creditedAt.
  const result = await fulfillPaidTopup({
    externalId,
    transaction: {
      uuid,
      status,
      amount: Number(txRaw.amount) || 0,
      currency: String(txRaw.currency || "RUB"),
      payment_method: txRaw.payment_method
        ? String(txRaw.payment_method)
        : null,
      external_id: externalId,
      paid_at: txRaw.paid_at ? String(txRaw.paid_at) : null,
      ...txRaw,
    },
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
      // Fan-out to live bots so dual-bot users get the notice where they chat.
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
        .catch((e) => console.error("[cashera] fv2 after topup:", e));
    } catch (e) {
      console.error("[cashera] notify user failed:", e);
      void import("@/lib/ops/errors")
        .then(({ reportOpsError }) =>
          reportOpsError({
            kind: "payment",
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
            userId: result.userId,
            stage: "cashera_notify",
            meta: { peaches: result.peaches, externalId },
          }),
        )
        .catch(() => undefined);
    }
  } else if (
    result.userId &&
    /^(failed|canceled|cancelled|expired|rejected)$/.test(status)
  ) {
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
                    locale === "en" ? "Top up again 🍑" : "Пополнить снова 🍑",
                  callback_data: onFv2 ? FV2.topup : "tu:open",
                },
              ],
            ],
          },
        },
      });
    } catch (e) {
      console.error("[cashera] payment_fail notify:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    event,
    status,
    credited: result.credited,
  });
}
