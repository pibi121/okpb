import { NextRequest, NextResponse } from "next/server";
import { verifyCasheraWebhookHeaders } from "@/lib/cashera";
import { fulfillPaidTopup } from "@/lib/tg/topup-payments";
import { prisma } from "@/lib/db";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { tFormat, type TgLocale } from "@/lib/tg/i18n";

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
      const acc = await prisma.platformAccount.findFirst({
        where: { userId: result.userId, platform: "telegram" },
        orderBy: { lastSeenAt: "desc" },
      });
      if (acc?.platformUserId) {
        const user = await prisma.user.findUnique({
          where: { id: result.userId },
          select: { locale: true, balancePeaches: true },
        });
        const locale = (user?.locale === "en" ? "en" : "ru") as TgLocale;
        await tgSendMessage(
          Number(acc.platformUserId),
          tFormat("topup_paid", locale, {
            n: result.peaches,
            balance: user?.balancePeaches ?? result.peaches,
          }),
        );
      }
    } catch (e) {
      console.error("[cashera] notify user failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    event,
    status,
    credited: result.credited,
  });
}
