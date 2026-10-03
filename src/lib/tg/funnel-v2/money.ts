/**
 * Funnel v2 user-facing money formatting (1 internal unit = 1 ₽).
 * UI shows rubles / USD; no peaches in copy.
 */
import { peachesToRub, peachesToUsdt } from "@/lib/tg-pricing";

/** Template / generation price: rubles only. */
export function formatRubOnly(peaches: number): string {
  const rub = peachesToRub(Math.max(0, Math.floor(peaches)));
  return `${rub}₽`;
}

/** Balance / pack face: `1000₽`. */
export function formatRub(peaches: number): string {
  return formatRubOnly(peaches);
}

/** `1000₽ (≈ $12.5)` */
export function formatRubUsd(peaches: number): string {
  const rub = peachesToRub(Math.max(0, Math.floor(peaches)));
  const usd = peachesToUsdt(rub);
  return `${rub}₽ (≈ $${usd})`;
}

/** Pay line: `1000 ₽ (≈ $12.5)` — optional extra currency later. */
export function formatPayAmount(
  peaches: number,
  opts?: { currencyCode?: string; currencyAmount?: string },
): string {
  const rub = peachesToRub(Math.max(0, Math.floor(peaches)));
  const usd = peachesToUsdt(rub);
  let s = `${rub} ₽ (≈ $${usd})`;
  if (opts?.currencyCode && opts.currencyAmount) {
    s += ` / ${opts.currencyAmount} ${opts.currencyCode}`;
  }
  return s;
}

/** Topup pack button: `1000₽` or `1000₽ + 150₽ бонус`. */
export function formatTopupPackButton(peaches: number, bonus: number): string {
  const base = formatRub(peaches);
  if (bonus > 0) return `${base} + ${formatRub(bonus)} бонус`;
  return base;
}
