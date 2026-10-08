/**
 * StreamPay merchant API (streampay.money / api.streampay.org).
 * Ed25519 signature: body|YYYYMMDD:HHmm (UTC) in `signature` header.
 */
import crypto from "node:crypto";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

export const STREAMPAY_API_BASE =
  process.env.STREAMPAY_API_BASE?.trim() || "https://api.streampay.org";

const ED25519_PRIV_PREFIX = "302e020100300506032b657004220420";
const ED25519_PUB_PREFIX = "302a300506032b6570032100";

export function streampayConfigured(): boolean {
  return Boolean(
    process.env.STREAMPAY_STORE_ID?.trim() &&
      process.env.STREAMPAY_PRIVATE_KEY?.trim() &&
      process.env.STREAMPAY_PUBLIC_KEY?.trim(),
  );
}

export function streampayStoreId(): number {
  const n = Number(process.env.STREAMPAY_STORE_ID?.trim() || 0);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("STREAMPAY_STORE_ID is not set");
  }
  return Math.floor(n);
}

function privateKeySeedHex(): string {
  const raw = (process.env.STREAMPAY_PRIVATE_KEY || "").trim().toLowerCase();
  // Cabinet private key is often seed(64 hex) + public(64 hex).
  const seed = raw.length >= 128 ? raw.slice(0, 64) : raw;
  if (!/^[0-9a-f]{64}$/.test(seed)) {
    throw new Error("STREAMPAY_PRIVATE_KEY invalid");
  }
  return seed;
}

export function streampayPublicKeyHex(): string {
  const raw = (process.env.STREAMPAY_PUBLIC_KEY || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new Error("STREAMPAY_PUBLIC_KEY invalid");
  }
  return raw;
}

function utcStamp(d = new Date()): string {
  return (
    d.getUTCFullYear().toString().padStart(4, "0") +
    (d.getUTCMonth() + 1).toString().padStart(2, "0") +
    d.getUTCDate().toString().padStart(2, "0") +
    ":" +
    d.getUTCHours().toString().padStart(2, "0") +
    d.getUTCMinutes().toString().padStart(2, "0")
  );
}

function loadPrivateKey() {
  return crypto.createPrivateKey({
    key: Buffer.from(ED25519_PRIV_PREFIX + privateKeySeedHex(), "hex"),
    format: "der",
    type: "pkcs8",
  });
}

function loadPublicKey() {
  return crypto.createPublicKey({
    key: Buffer.from(ED25519_PUB_PREFIX + streampayPublicKeyHex(), "hex"),
    format: "der",
    type: "spki",
  });
}

/** Sign exact JSON body string + UTC minute stamp. */
export function signStreampayBody(body: string, at = new Date()): string {
  const text = body + utcStamp(at);
  return crypto.sign(null, Buffer.from(text, "utf8"), loadPrivateKey()).toString("hex");
}

/**
 * Verify callback signature over sorted query `k=v&…` + UTC minute
 * (also try previous UTC minute).
 */
export function verifyStreampayCallback(
  query: Record<string, string>,
  signatureHex: string | null,
): boolean {
  const sig = String(signatureHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(sig) || sig.length < 64) return false;
  if (!streampayConfigured()) return false;
  try {
    const paramsBuf = Buffer.from(
      Object.keys(query)
        .sort()
        .map((k) => `${k}=${query[k]}`)
        .join("&"),
      "utf8",
    );
    const pub = loadPublicKey();
    const sigBuf = Buffer.from(sig, "hex");
    const now = new Date();
    for (let i = 0; i < 2; i++) {
      const d = new Date(now.getTime() - i * 60_000);
      const buf = Buffer.concat([paramsBuf, Buffer.from(utcStamp(d), "utf8")]);
      if (crypto.verify(null, buf, pub, sigBuf)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function streampayCallbackUrl(): string {
  const override = process.env.STREAMPAY_CALLBACK_URL?.trim();
  if (override) return override;
  return `${publicSiteBaseUrl()}/api/webhooks/streampay`;
}

export function streampaySuccessUrl(): string {
  return (
    process.env.STREAMPAY_SUCCESS_URL?.trim() ||
    `${publicSiteBaseUrl()}/tg/topup/ok`
  );
}

export function streampayFailUrl(): string {
  return (
    process.env.STREAMPAY_FAIL_URL?.trim() ||
    `${publicSiteBaseUrl()}/tg/topup/fail`
  );
}

export type StreampayCreateResult = {
  invoice: string;
  payUrl: string;
  raw: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createStreampayInvoice(opts: {
  customer: string;
  externalId: string;
  description: string;
  /** payment_type 1: amount in `currency`; type 2: amount in USDT. */
  paymentType: 1 | 2;
  amount: number;
  currency?: string;
  systemCurrency?: string;
  lang?: string;
}): Promise<StreampayCreateResult> {
  const payload: Record<string, unknown> = {
    store_id: streampayStoreId(),
    customer: opts.customer.slice(0, 256),
    external_id: opts.externalId.slice(0, 128),
    description: opts.description.slice(0, 500),
    system_currency: opts.systemCurrency || "USDT",
    payment_type: opts.paymentType,
    amount: opts.amount,
    success_url: streampaySuccessUrl(),
    fail_url: streampayFailUrl(),
    cancel_url: streampayFailUrl(),
  };
  if (opts.paymentType === 1) {
    if (!opts.currency) throw new Error("currency required for payment_type 1");
    payload.currency = opts.currency;
  }
  if (opts.lang) payload.lang = opts.lang;

  const body = JSON.stringify(payload);
  const doFetch = async () => {
    const res = await fetch(`${STREAMPAY_API_BASE}/api/payment/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        signature: signStreampayBody(body),
      },
      body,
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    return { res, json, text };
  };

  let { res, json, text } = await doFetch();
  for (let i = 0; i < 4 && res.status === 202; i++) {
    const messages = String(json.messages || "");
    if (messages !== "paylink_is_not_ready") break;
    await sleep(1500);
    ({ res, json, text } = await doFetch());
  }

  if (res.status === 403) {
    console.error("[streampay] invalid signature");
    throw new Error("Не удалось создать ссылку на оплату. Попробуй ещё раз.");
  }
  if (!res.ok || Number(json.status) !== 200) {
    console.error("[streampay] create failed", {
      http: res.status,
      status: json.status,
      messages: json.messages,
      body: text.slice(0, 400),
    });
    const messages = String(json.messages || "");
    if (/limit|amount|min|max/i.test(messages)) {
      throw new Error("Сумма вне лимита этого способа. Выбери другую сумму.");
    }
    throw new Error(
      "Не удалось создать ссылку на оплату. Попробуй ещё раз через минуту.",
    );
  }

  const data = (json.data || {}) as Record<string, unknown>;
  const invoice = String(data.invoice || "").trim();
  const payUrl = String(data.pay_url || "").trim();
  if (!invoice || !/^https?:\/\//i.test(payUrl)) {
    console.error("[streampay] bad create payload", data);
    throw new Error(
      "Не удалось создать ссылку на оплату. Попробуй ещё раз через минуту.",
    );
  }
  return { invoice, payUrl, raw: json };
}
