import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { TG_MAX_TOPUP_PEACHES, TG_MIN_TOPUP_PEACHES, TG_QUICK_TOPUP_AMOUNTS } from "@/lib/tg-pricing";
import { casheraConfigured } from "@/lib/cashera";
import { streampayConfigured } from "@/lib/streampay";
import {
  createTopupPayment,
  formatTopupPriceLine,
  isActiveTopupMethod,
  isCasheraTopupMethod,
  isStreampayMethodId,
  TOPUP_PAYMENT_METHODS,
  type TopupPaymentMethodId,
} from "@/lib/tg/topup-payments";
import { createStreampayTopupPayment } from "@/lib/tg/streampay-topup";
import { userFacingTgError } from "@/lib/tg/user-facing-error";

export const runtime = "nodejs";

/** Mini App: quote + methods. */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const peaches = Math.floor(Number(url.searchParams.get("peaches") || 0));
  return NextResponse.json({
    configured: casheraConfigured() || streampayConfigured(),
    cashera: casheraConfigured(),
    streampay: streampayConfigured(),
    minPeaches: TG_MIN_TOPUP_PEACHES,
    maxPeaches: TG_MAX_TOPUP_PEACHES,
    quickAmounts: [...TG_QUICK_TOPUP_AMOUNTS],
    methods: TOPUP_PAYMENT_METHODS,
    priceLine:
      peaches >= TG_MIN_TOPUP_PEACHES
        ? formatTopupPriceLine(peaches, "ru")
        : null,
  });
}

/** Mini App: create Cashera / StreamPay payment and return payment_url. */
export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { peaches?: number; method?: string; locale?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const peaches = Math.floor(Number(body.peaches) || 0);
  const method = String(body.method || "") as TopupPaymentMethodId;
  if (!isActiveTopupMethod(method)) {
    return NextResponse.json(
      { error: "bad_method", message: "Unknown payment method" },
      { status: 400 },
    );
  }
  if (isCasheraTopupMethod(method) && !casheraConfigured()) {
    return NextResponse.json(
      { error: "payments_offline", message: "Cashera keys not configured" },
      { status: 503 },
    );
  }
  if (isStreampayMethodId(method) && !streampayConfigured()) {
    return NextResponse.json(
      { error: "payments_offline", message: "StreamPay keys not configured" },
      { status: 503 },
    );
  }
  if (peaches < TG_MIN_TOPUP_PEACHES) {
    return NextResponse.json(
      { error: "min", min: TG_MIN_TOPUP_PEACHES },
      { status: 400 },
    );
  }
  if (peaches > TG_MAX_TOPUP_PEACHES) {
    return NextResponse.json(
      { error: "max", max: TG_MAX_TOPUP_PEACHES },
      { status: 400 },
    );
  }

  try {
    const locale = body.locale === "en" ? "en" : "ru";
    const pay = isStreampayMethodId(method)
      ? await createStreampayTopupPayment({
          userId,
          peaches,
          method,
          locale,
        })
      : await createTopupPayment({
          userId,
          peaches,
          method,
          locale,
        });
    return NextResponse.json({
      ok: true,
      paymentUrl: pay.paymentUrl,
      orderId: pay.orderId,
      priceLine: pay.priceLine,
      peaches: pay.peaches,
    });
  } catch (e) {
    console.error("[api/tg/topup]", e);
    return NextResponse.json(
      { error: userFacingTgError(e, "payment_failed") },
      { status: 502 },
    );
  }
}
