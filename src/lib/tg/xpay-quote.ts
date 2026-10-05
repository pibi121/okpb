/**
 * Local-currency top-up quote. Pure: no I/O, no secrets.
 * Face amount is what we show and credit. The provider form is grossed up
 * by the fee (amount / (1 - fee)) so the cabinet still receives the face.
 */

export type LocalTopupQuote = {
  bumped: boolean;
  selectedRub: number;
  /** Rubles credited before pack bonus and fee rebate. */
  faceRub: number;
  /** Integer local units shown as «К оплате» (fee not included). */
  localFace: number;
  /** Integer local units sent to the provider (includes fee). */
  localCharge: number;
};

function ceilRatio(numerator: number, denominator: number): number {
  if (!(denominator > 0) || !Number.isFinite(numerator)) {
    throw new Error("bad_quote");
  }
  return Math.ceil(numerator / denominator - 1e-8);
}

/** Whole local units for a ruble amount. `rubPerLocal` is RUB for 1 local unit. */
export function localUnitsForRub(rub: number, rubPerLocal: number): number {
  return Math.max(1, ceilRatio(rub, rubPerLocal));
}

/** Whole rubles covering `local` units (rounds up so the user is not short). */
export function rubForLocal(local: number, rubPerLocal: number): number {
  if (!(rubPerLocal > 0) || !Number.isFinite(local)) {
    throw new Error("bad_quote");
  }
  return Math.max(1, Math.ceil(local * rubPerLocal - 1e-8));
}

export function grossUpLocal(localFace: number, feeRate: number): number {
  if (!(feeRate >= 0) || feeRate >= 1) throw new Error("bad_fee");
  return ceilRatio(localFace, 1 - feeRate);
}

export function quoteLocalTopup(input: {
  selectedRub: number;
  rubPerLocal: number;
  minLocal: number;
  maxLocal: number;
  feeRate: number;
}): LocalTopupQuote {
  const selectedRub = Math.floor(input.selectedRub);
  if (selectedRub <= 0) throw new Error("bad_quote");
  const selectedLocal = localUnitsForRub(selectedRub, input.rubPerLocal);
  const bumped = selectedLocal < input.minLocal;
  const localFace = bumped ? input.minLocal : selectedLocal;
  if (localFace > input.maxLocal) {
    throw new Error("amount_above_max");
  }
  const localCharge = grossUpLocal(localFace, input.feeRate);
  if (localCharge > input.maxLocal) {
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
    localCharge,
  };
}

export function formatGroupedInt(n: number): string {
  const v = Math.round(n);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
