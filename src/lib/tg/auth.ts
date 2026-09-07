import crypto from "crypto";

export type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type InitDataValidationFailure =
  | "empty"
  | "missing_token"
  | "missing_hash"
  | "bad_hash"
  | "expired";

function ordinalSort(a: string, b: string) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function timingSafeEqualHex(a: string, b: string) {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Validate Telegram Mini App `initData` per official bot-token HMAC spec. */
export function validateTelegramInitDataDetailed(
  initData: string,
  botToken: string,
):
  | { ok: true; fields: Record<string, string> }
  | { ok: false; reason: InitDataValidationFailure } {
  if (!initData?.trim()) return { ok: false, reason: "empty" };
  if (!botToken) return { ok: false, reason: "missing_token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  // First-party HMAC: exclude ONLY `hash`. Keep `signature` in the check string.
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => ordinalSort(a, b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualHex(calculated, hash)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) {
    return { ok: false, reason: "expired" };
  }

  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return { ok: true, fields: out };
}

/** Validate Telegram Mini App `initData` per official spec. */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
): Record<string, string> | null {
  const result = validateTelegramInitDataDetailed(initData, botToken);
  return result.ok ? result.fields : null;
}

export function parseTelegramUser(
  fields: Record<string, string>,
): TelegramWebAppUser | null {
  const raw = fields.user;
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as TelegramWebAppUser;
    if (!u?.id) return null;
    return u;
  } catch {
    return null;
  }
}

export function telegramSyntheticEmail(platformUserId: string): string {
  return `tg_${platformUserId}@peachbitch.local`;
}
