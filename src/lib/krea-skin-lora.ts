/** Krea2 skin texture LoRA (Loraholic Skin Detail Slider). */
export const KREA_SKIN_DETAIL_LORA = "krea2/skindetails_krea2_loraholic.safetensors";

/** Recommended first-pass strength when stacked with character + NSFW LoRAs. */
export const KREA_SKIN_DETAIL_DEFAULT_STRENGTH = 1.2;

export const KREA_SKIN_DETAIL_STRENGTH_MIN = 0;
export const KREA_SKIN_DETAIL_STRENGTH_MAX = 3.5;

export function normalizeSkinDetailStrength(raw: unknown): number | null {
  if (raw === false || raw === 0 || raw === "0") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(KREA_SKIN_DETAIL_STRENGTH_MAX, Math.max(0.1, n));
}

export function resolveSkinDetail(opts: {
  skinDetail?: boolean;
  skinDetailStrength?: number;
}): { enabled: boolean; strength: number } {
  const strength =
    normalizeSkinDetailStrength(opts.skinDetailStrength) ??
    (opts.skinDetail === false ? null : KREA_SKIN_DETAIL_DEFAULT_STRENGTH);
  if (strength == null) return { enabled: false, strength: 0 };
  return { enabled: true, strength };
}
