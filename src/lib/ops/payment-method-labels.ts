/**
 * Human-readable payment method labels for OPS analytics / Telegram.
 * Keep in sync with TOPUP_PAYMENT_METHODS ids.
 */

export const PAYMENT_METHOD_LABEL_RU: Record<string, string> = {
  sbp: "РФ · СБП",
  sp_sbp: "РФ · СБП резерв",
  crypto: "Крипта",
  cryptobot: "CryptoBot",
  card: "Карта",
  sp_kz: "Казахстан",
  sp_by: "Беларусь",
  sp_ua: "Украина",
  kz_card: "Казахстан (XPay)",
  uz_card: "Узбекистан (XPay)",
};

export function paymentMethodLabelRu(method: string): string {
  return PAYMENT_METHOD_LABEL_RU[method] || method || "—";
}
