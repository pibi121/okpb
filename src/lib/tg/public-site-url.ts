/** Public HTTPS origin for Mini App, rules links, and static media. */

function stripTgPath(raw: string): string {
  return raw
    .replace(/\/tg\/templates\/?$/i, "")
    .replace(/\/tg\/?$/i, "")
    .replace(/\/$/, "");
}

export function publicSiteBaseUrl(): string {
  const fromEnv =
    process.env.TELEGRAM_BOT_SITE_URL?.trim() ||
    process.env.TELEGRAM_MINIAPP_URL?.trim() ||
    "";
  if (fromEnv) return stripTgPath(fromEnv);

  const railway =
    process.env.RAILWAY_PUBLIC_DOMAIN?.trim() ||
    process.env.RAILWAY_STATIC_URL?.trim() ||
    "";
  if (railway) {
    const host = railway.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  return "http://127.0.0.1:3000";
}
