import type { TgLocale } from "@/lib/tg/i18n";

/** Support handle or URL from env (Help + Mini App footer). */
export function tgSupportContact(): string {
  return process.env.TG_SUPPORT_CONTACT?.trim() || "@peachbitch_support";
}

/** Openable Telegram URL for support chat. */
export function tgSupportUrl(): string {
  const raw = tgSupportContact();
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "").replace(/^t\.me\//i, "");
  return `https://t.me/${handle}`;
}

export function tgReserveLinks(): string {
  const raw = process.env.TG_RESERVE_LINKS?.trim();
  if (raw) return raw;
  return "https://t.me/+6aVo5HU0Yrc4NjYy";
}

/** In-app path to the same rules article as onboarding step 2. */
export function tgRulesMiniAppPath(locale: TgLocale): string {
  return `/tg/rules?lang=${locale === "en" ? "en" : "ru"}`;
}
