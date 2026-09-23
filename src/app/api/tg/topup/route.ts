import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { TG_MIN_TOPUP_PEACHES, TG_QUICK_TOPUP_AMOUNTS } from "@/lib/tg-pricing";
import { casheraConfigured } from "@/lib/cashera";
import {
  createTopupPayment,
  formatTopupPriceLine,
  isActiveTopupMethod,
  TOPUP_PAYMENT_METHODS,
} from "@/lib/tg/topup-payments";
import type { CasheraPaymentMethod } from "@/lib/cashera";

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
    configured: casheraConfigured(),
    minPeaches: TG_MIN_TOPUP_PEACHES,
    quickAmounts: [...TG_QUICK_TOPUP_AMOUNTS],
    methods: TOPUP_PAYMENT_METHODS,
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
  if (!casheraConfigured()) {
    return NextResponse.json(
      { error: "payments_offline", message: "Cashera keys not configured" },
      { status: 503 },
    );
  }

  let body: { peaches?: number; method?: string; locale?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const peaches = Math.floor(Number(body.peaches) || 0);
  const method = String(body.method || "") as CasheraPaymentMethod;
  if (!isActiveTopupMethod(method)) {
    return NextResponse.json(
      { error: "bad_method", message: "Use sbp or crypto" },
      { status: 400 },
    );
  }
  if (peaches < TG_MIN_TOPUP_PEACHES) {
    return NextResponse.json(
      { error: "min", min: TG_MIN_TOPUP_PEACHES },
      { status: 400 },
    );
  }

  try {
    const pay = await createTopupPayment({
      userId,
      peaches,
      method,
      locale: body.locale === "en" ? "en" : "ru",
    });
    return NextResponse.json({
      ok: true,
      paymentUrl: pay.paymentUrl,
      orderId: pay.orderId,
      priceLine: pay.priceLine,
      peaches: pay.peaches,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
