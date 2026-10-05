import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { TG_MAX_TOPUP_PEACHES, TG_MIN_TOPUP_PEACHES, TG_QUICK_TOPUP_AMOUNTS } from "@/lib/tg-pricing";
import { casheraConfigured } from "@/lib/cashera";
import { xpayCabinetConfigured } from "@/lib/xpay";
import {
  createTopupPayment,
  formatTopupPriceLine,
  isActiveTopupMethod,
  visibleTopupMethods,
} from "@/lib/tg/topup-payments";
import { createXpayTopupPayment, isXpayTopupMethod } from "@/lib/tg/xpay-topup";
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
  const xpayOn =
    xpayCabinetConfigured("kz") || xpayCabinetConfigured("uz");
  return NextResponse.json({
    configured: casheraConfigured() || xpayOn,
    minPeaches: TG_MIN_TOPUP_PEACHES,
    maxPeaches: TG_MAX_TOPUP_PEACHES,
    quickAmounts: [...TG_QUICK_TOPUP_AMOUNTS],
    methods: visibleTopupMethods(),
    priceLine:
      peaches >= TG_MIN_TOPUP_PEACHES
        ? formatTopupPriceLine(peaches, "ru")
        : null,
  });
}

/** Mini App: create Cashera payment and return payment_url. */
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
  const method = String(body.method || "");
  if (!isActiveTopupMethod(method)) {
    return NextResponse.json(
      { error: "bad_method", message: "Unknown payment method" },
      { status: 400 },
    );
  }
  const xpay = isXpayTopupMethod(method);
  if (xpay && !xpayCabinetConfigured(method === "kz_card" ? "kz" : "uz")) {
    return NextResponse.json(
      { error: "payments_offline", message: "Card payments are not configured" },
      { status: 503 },
    );
  }
  if (!xpay && !casheraConfigured()) {
    return NextResponse.json(
      { error: "payments_offline", message: "Cashera keys not configured" },
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
    const pay = xpay
      ? await createXpayTopupPayment({
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
      notice: "notice" in pay ? pay.notice : null,
      bumped: "bumped" in pay ? pay.bumped : false,
    });
  } catch (e) {
    console.error("[api/tg/topup]", e);
    return NextResponse.json(
      { error: userFacingTgError(e, "payment_failed") },
      { status: 502 },
    );
  }
}
