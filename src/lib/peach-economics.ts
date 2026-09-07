/** Утверждённые SKU — docs/ECONOMICS-APPROVED.md */
export const PEACH_USD = 0.01;

export const SKU = {
  photo: 6,
  editFirst: 0,
  editNext: 3,
  regen: 5,
  clip5: 45,
  clip10: 80,
  clip15: 115,
  music: 10,
  socialRef2V: 95,
  faceswapSetup: 80,
  loraTrain: 1200,
} as const;

export function photoBatchCost(count: number): number {
  const n = Math.max(1, Math.min(4, Math.round(count)));
  return SKU.photo * n;
}

export function clipCost(durationSec: number): number {
  if (durationSec <= 5) return SKU.clip5;
  if (durationSec <= 10) return SKU.clip10;
  return SKU.clip15;
}
