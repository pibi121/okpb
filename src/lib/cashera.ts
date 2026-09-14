/**
 * Cashera payment gateway (SBP / card / crypto).
 * Docs: https://docs.cashera.cash
 */
import crypto from "node:crypto";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

export const CASHERA_BASE =
  process.env.CASHERA_API_BASE?.trim() || "https://api.cashera.cash/api/v1";

export type CasheraPaymentMethod = "sbp" | "card" | "crypto";

export type CasheraTransaction = {
  uuid: string;
  status: string;
  amount: number;
  currency: string;
  payment_method?: string | null;
  external_id?: string | null;
  payment_url?: string | null;
  paid_at?: string | null;
  [key: string]: unknown;
};

export function casheraConfigured(): boolean {
  return Boolean(
    process.env.CASHERA_API_KEY?.trim() && process.env.CASHERA_API_SECRET?.trim(),
  );
}

export function casheraApiKey(): string {
  const k = process.env.CASHERA_API_KEY?.trim();
  if (!k) throw new Error("CASHERA_API_KEY is not set");
  return k;
}

export function casheraApiSecret(): string {
  const s = process.env.CASHERA_API_SECRET?.trim();
  if (!s) throw new Error("CASHERA_API_SECRET is not set");
  return s;
}

/** RUB major → minor (kopecks). */
export function rubToMinor(rub: number): number {
  return Math.max(1, Math.round(rub * 100));
}

export function casheraCallbackUrl(): string {
  const override = process.env.CASHERA_CALLBACK_URL?.trim();
  if (override) return override;
  return `${publicSiteBaseUrl()}/api/webhooks/cashera`;
}

export function casheraSuccessUrl(): string {
  return (
    process.env.CASHERA_SUCCESS_URL?.trim() ||
    `${publicSiteBaseUrl()}/tg/topup/ok`
  );
}

export function casheraFailUrl(): string {
  return (
    process.env.CASHERA_FAIL_URL?.trim() ||
    `${publicSiteBaseUrl()}/tg/topup/fail`
  );
}

export async function createCasheraPayment(opts: {
  amountMinor: number;
  currency?: string;
  paymentMethod: CasheraPaymentMethod;
  externalId: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<CasheraTransaction> {
  const body = {
    amount: opts.amountMinor,
    currency: opts.currency || "RUB",
    payment_method: opts.paymentMethod,
    external_id: opts.externalId,
    description: opts.description.slice(0, 255),
    callback_url: casheraCallbackUrl(),
    success_url: casheraSuccessUrl(),
    fail_url: casheraFailUrl(),
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
  };

  const res = await fetch(`${CASHERA_BASE}/integration/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": casheraApiKey(),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const detail =
      typeof json.error === "string"
        ? json.error
        : typeof json.message === "string"
          ? json.message
          : text.slice(0, 300);
    throw new Error(`Cashera ${res.status}: ${detail || "create failed"}`);
  }

  const tx = (json.transaction || json) as CasheraTransaction;
  if (!tx?.uuid || !tx.payment_url) {
    throw new Error("Cashera response missing uuid/payment_url");
  }
  return tx;
}

export async function getCasheraByExternalId(
  externalId: string,
): Promise<CasheraTransaction | null> {
  const res = await fetch(
    `${CASHERA_BASE}/integration/transactions/by-external-id/${encodeURIComponent(externalId)}`,
    {
      headers: { "X-Api-Key": casheraApiKey() },
    },
  );
  if (res.status === 404) return null;
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) return null;
  return (json.transaction || json) as CasheraTransaction;
}

/** Constant-time compare of webhook X-Api-Key / X-Secret headers. */
export function verifyCasheraWebhookHeaders(opts: {
  apiKeyHeader: string | null;
  secretHeader: string | null;
}): boolean {
  try {
    const key = casheraApiKey();
    const secret = casheraApiSecret();
    const hk = (opts.apiKeyHeader || "").trim();
    const hs = (opts.secretHeader || "").trim();
    if (!hk || !hs) return false;
    const a = Buffer.from(hk);
    const b = Buffer.from(key);
    const c = Buffer.from(hs);
    const d = Buffer.from(secret);
    if (a.length !== b.length || c.length !== d.length) return false;
    return crypto.timingSafeEqual(a, b) && crypto.timingSafeEqual(c, d);
  } catch {
    return false;
  }
}
