/**
 * XPayConnect merchant API. Keys stay in env (XPAY_KZ_API_KEY / XPAY_UZ_API_KEY).
 * Docs: https://docs.xpayconnect.io
 */
import crypto from "node:crypto";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

export type XpayCabinetId = "kz" | "uz";

const API_BASE =
  process.env.XPAY_API_BASE?.trim() || "https://api.xpayconnect.io";

const CABINET_ENV: Record<XpayCabinetId, string> = {
  kz: "XPAY_KZ_API_KEY",
  uz: "XPAY_UZ_API_KEY",
};

export function xpayCabinetConfigured(cabinet: XpayCabinetId): boolean {
  return Boolean(process.env[CABINET_ENV[cabinet]]?.trim());
}

function apiKey(cabinet: XpayCabinetId): string {
  const key = process.env[CABINET_ENV[cabinet]]?.trim();
  if (!key) throw new Error("Этот способ оплаты ещё не настроен.");
  return key;
}

/** SHA-256 hex of `apiKey|body`. Body is the exact JSON string sent, or "" for GET. */
export function xpaySignature(apiKeyValue: string, body: string): string {
  return crypto
    .createHash("sha256")
    .update(`${apiKeyValue}|${body}`)
    .digest("hex");
}

export function verifyXpayWebhook(
  cabinet: XpayCabinetId,
  rawBody: string,
  header: string | null,
): boolean {
  if (!xpayCabinetConfigured(cabinet)) return false;
  const received = String(header || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const expected = xpaySignature(apiKey(cabinet), rawBody);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(received, "utf8"),
    );
  } catch {
    return false;
  }
}

export function xpayCallbackUrl(cabinet: XpayCabinetId): string {
  return `${publicSiteBaseUrl()}/api/webhooks/xpay/${cabinet}`;
}

export type XpayCreatedOrder = {
  id: string;
  orderId: string;
  amount: string;
  status: string;
  substatus: string;
  isFinal: boolean;
  formUrl: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export function parseXpayOrder(json: unknown): XpayCreatedOrder | null {
  const root = asRecord(json);
  const data = asRecord(root?.data) || root;
  if (!data) return null;
  const details = asRecord(data.payment_details);
  const formUrl = String(details?.form_url || "").trim();
  const address = String(details?.address || "").trim();
  const link = /^https?:\/\//i.test(formUrl)
    ? formUrl
    : /^https?:\/\//i.test(address)
      ? address
      : "";
  return {
    id: String(data.id || ""),
    orderId: String(data.order_id || ""),
    amount: String(data.amount || ""),
    status: String(data.status || ""),
    substatus: String(data.substatus || ""),
    isFinal: Boolean(data.is_final),
    formUrl: link,
  };
}

function safeXpayError(json: unknown, status: number): Error {
  const root = asRecord(json);
  const err = asRecord(root?.error);
  const code = String(err?.code || "");
  const requestId = String(err?.request_id || "");
  console.error("[xpay] order failed", { status, code, requestId });
  if (code === "AMOUNT_OUT_OF_LIMITS") {
    return new Error("Сумма вне лимита этого способа. Выбери другую сумму.");
  }
  return new Error(
    "Не удалось создать ссылку на оплату. Попробуй ещё раз через минуту.",
  );
}

async function xpayRequest(
  cabinet: XpayCabinetId,
  path: string,
  body: string | null,
): Promise<{ status: number; json: unknown }> {
  const key = apiKey(cabinet);
  const payload = body ?? "";
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === null ? "GET" : "POST",
    headers: {
      accept: "application/json",
      "client-api-key": key,
      "x-api-key": xpaySignature(key, payload),
      ...(body !== null ? { "content-type": "application/json" } : {}),
    },
    body: body ?? undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createXpayPayin(opts: {
  cabinet: XpayCabinetId;
  orderId: string;
  amount: number;
  type: string;
  currency: string;
  clientId: string;
}): Promise<XpayCreatedOrder> {
  const body = JSON.stringify({
    order_id: opts.orderId,
    amount: opts.amount,
    type: opts.type,
    currency: opts.currency,
    callback_url: xpayCallbackUrl(opts.cabinet),
    client_id: opts.clientId,
  });
  const created = await xpayRequest(
    opts.cabinet,
    "/v1/merchant/orders",
    body,
  );
  if (created.status >= 400 || asRecord(created.json)?.ok === false) {
    throw safeXpayError(created.json, created.status);
  }
  let order = parseXpayOrder(created.json);
  for (let i = 0; i < 4 && order && !order.formUrl && !order.isFinal; i++) {
    await sleep(2000);
    const polled = await xpayRequest(
      opts.cabinet,
      `/v1/merchant/orders/${encodeURIComponent(opts.orderId)}`,
      null,
    );
    if (polled.status >= 400) break;
    order = parseXpayOrder(polled.json) || order;
  }
  if (!order?.formUrl) {
    console.error("[xpay] no form_url", {
      cabinet: opts.cabinet,
      orderId: opts.orderId,
      status: order?.status || "",
      substatus: order?.substatus || "",
    });
    throw new Error(
      "Не удалось создать ссылку на оплату. Попробуй ещё раз через минуту.",
    );
  }
  return order;
}
