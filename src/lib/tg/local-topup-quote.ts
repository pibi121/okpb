/**
 * Local-currency top-up quote from RUB face. Pure: no I/O.
 * StreamPay charges fee on the payment page (client pays), so we invoice
 * face local amount and rebate % as peaches separately.
 */

export type LocalTopupQuote = {
  bumped: boolean;
  selectedRub: number;
  /** Rubles credited before pack bonus and fee rebate. */
  faceRub: number;
  /** Local units sent to the provider (face; fee not included). */
  localFace: number;
};

function ceilRatio(numerator: number, denominator: number): number {
  if (!(denominator > 0) || !Number.isFinite(numerator)) {
    throw new Error("bad_quote");
  }
  return Math.ceil(numerator / denominator - 1e-8);
}

/** Whole/stepped local units for a ruble amount. `rubPerLocal` is RUB for 1 local. */
export function localUnitsForRub(
  rub: number,
  rubPerLocal: number,
  precision = 0,
): number {
  const raw = rub / rubPerLocal;
  if (!(rubPerLocal > 0) || !Number.isFinite(raw)) throw new Error("bad_quote");
  if (precision <= 0) return Math.max(1, Math.ceil(raw - 1e-8));
  const step = 10 ** precision;
  return Math.max(1 / step, Math.ceil(raw * step - 1e-8) / step);
}

/** Whole rubles covering `local` units (rounds up so the user is not short). */
export function rubForLocal(local: number, rubPerLocal: number): number {
  if (!(rubPerLocal > 0) || !Number.isFinite(local)) {
    throw new Error("bad_quote");
  }
  return Math.max(1, Math.ceil(local * rubPerLocal - 1e-8));
}

export function quoteLocalTopup(input: {
  selectedRub: number;
  rubPerLocal: number;
  minLocal: number;
  maxLocal: number;
  precision?: number;
}): LocalTopupQuote {
  const selectedRub = Math.floor(input.selectedRub);
  if (selectedRub <= 0) throw new Error("bad_quote");
  const precision = input.precision ?? 0;
  const selectedLocal = localUnitsForRub(
    selectedRub,
    input.rubPerLocal,
    precision,
  );
  const bumped = selectedLocal < input.minLocal;
  const localFace = bumped ? input.minLocal : selectedLocal;
  if (localFace > input.maxLocal) {
    throw new Error("amount_above_max");
  }
  const faceRub = bumped
    ? rubForLocal(input.minLocal, input.rubPerLocal)
    : selectedRub;
  return {
    bumped,
    selectedRub,
    faceRub,
    localFace,
  };
}

export function formatGroupedInt(n: number): string {
  const v = Math.round(n);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatLocalAmount(n: number, precision: number): string {
  if (precision <= 0) return formatGroupedInt(n);
  const fixed = Number(n).toFixed(precision);
  const [a, b] = fixed.split(".");
  return `${formatGroupedInt(Number(a))}${b ? `,${b}` : ""}`;
}
