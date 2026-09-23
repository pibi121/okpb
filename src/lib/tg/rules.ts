import type { TgLocale } from "@/lib/tg/i18n";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

/** Long-read rules (Telegram article / Instant View). */
export function tgRulesArticleUrl(locale: TgLocale): string {
  const site = publicSiteBaseUrl();
  if (locale === "en") {
    return (
      process.env.TELEGRAM_RULES_ARTICLE_URL_EN ||
      `${site}/tg/rules?lang=en`
    );
  }
  return (
    process.env.TELEGRAM_RULES_ARTICLE_URL_RU ||
      `${site}/tg/rules?lang=ru`
  );
}

/** Short rules blurb with link — full text lives in the article page. */
export function tgRulesShortMessage(locale: TgLocale): string {
  const url = tgRulesArticleUrl(locale);
  if (locale === "en") {
    return `You must be <b>18+</b>. By continuing you accept our <a href="${url}">Terms &amp; Rules</a>.`;
  }
  return `Тебе должно быть <b>18+</b>. Продолжая, ты принимаешь <a href="${url}">правила сервиса</a>.`;
}

export const TG_PAYMENT_NOTE = {
  ru: "Оплата: СБП или крипта (USDT) через наш платёжный сервис. Сумма также показывается в USDT для удобства.",
  en: "Pay with SBP or crypto (USDT) via our payment provider. Amount is also shown in USDT for convenience.",
};

/** Explains affiliate «cookie» — first ref link wins forever. */
export function tgAffiliateAttributionNote(
  locale: TgLocale,
  commissionPct = 50,
): string {
  const pct = Math.max(0, Math.min(100, Math.round(commissionPct)));
  if (locale === "en") {
    return `Affiliate attribution: if a user arrives via <code>?start=ref_XXX</code>, we link them to that partner <b>for life</b> (same Telegram account). All their top-ups pay <b>${pct}%</b> to that partner.`;
  }
  return `«Куки» партнёрки: если юзер пришёл по ссылке <code>?start=ref_XXX</code>, мы <b>навсегда</b> привязываем его к этому партнёру. Все пополнения этого юзера дают партнёру <b>${pct}%</b> — даже через месяц с другого устройства (пока тот же Telegram-аккаунт).`;
}

/** @deprecated use tgAffiliateAttributionNote(locale, pct) */
export const TG_AFFILIATE_ATTRIBUTION_NOTE = {
  ru: tgAffiliateAttributionNote("ru", 50),
  en: tgAffiliateAttributionNote("en", 50),
};