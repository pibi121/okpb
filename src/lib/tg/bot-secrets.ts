import crypto from "crypto";

const ALGO = "aes-256-gcm";

function keyBytes() {
  const secret = process.env.AUTH_SECRET || process.env.BOOTSTRAP_ADMIN_SECRET || "peachbitch-dev-secret";
  return crypto.createHash("sha256").update(`tg-bot-token:${secret}`).digest();
}

/** Encrypt Telegram bot token for DB storage. */
export function encryptBotToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptBotToken(enc: string): string | null {
  if (!enc?.trim()) return null;
  try {
    const [ver, ivB64, tagB64, dataB64] = enc.split(":");
    if (ver !== "v1" || !ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv(
      ALGO,
      keyBytes(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const out = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

export function maskToken(token: string) {
  const t = token.trim();
  if (t.length < 12) return "***";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}
