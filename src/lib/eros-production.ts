/**
 * Locked production MiniMax video stack (eval 2026-08-26).
 *
 * Classroom+Park = Ref2V; gallery «Оживить» = I2V.
 * A/B scripts pass explicit overrides and are unaffected when they set
 * minimaxBase / steps / lorasOverride.
 */
import type { MinimaxLoraSpec } from "@/lib/anatomy-loras";
import type { MinimaxBaseId } from "@/lib/minimax-base";
import { FURRY_NSFW_LORA_NAME } from "@/lib/sex-loras";

export const EROS_PRODUCTION = {
  /** Flip to false to revert stock FL2VA/Ref2VA + 20-step defaults. */
  enabled: true,
  decidedAt: "2026-08-26",
  nextGpuNote: "Continue on new GPU tomorrow — keep these defaults.",
  minimaxBase: "eros_max" as MinimaxBaseId,
  samplerName: "er_sde",
  schedulerName: "simple",
  /** Ref2V (quick video / film ref2v): park liked 0.65, classroom 0.85@7 → 0.75@7. */
  ref2v: {
    steps: 7,
    furryStrength: 0.75,
  },
  /** I2V (gallery animate): winner furry 0.85 @ 6. */
  i2v: {
    steps: 6,
    furryStrength: 0.85,
  },
  furryLoraName: FURRY_NSFW_LORA_NAME,
} as const;

export function productionMinimaxBase(
  override?: MinimaxBaseId | string | null,
): MinimaxBaseId | string | null | undefined {
  if (override !== undefined) return override;
  return EROS_PRODUCTION.enabled ? EROS_PRODUCTION.minimaxBase : undefined;
}

export function productionSampling(kind: "ref2v" | "i2v"): {
  steps?: number;
  samplerName?: string;
  schedulerName?: string;
} {
  if (!EROS_PRODUCTION.enabled) return {};
  const pack = kind === "ref2v" ? EROS_PRODUCTION.ref2v : EROS_PRODUCTION.i2v;
  return {
    steps: pack.steps,
    samplerName: EROS_PRODUCTION.samplerName,
    schedulerName: EROS_PRODUCTION.schedulerName,
  };
}

/** Append furry e31 once (production default path only). */
export function withProductionFurry(
  loras: MinimaxLoraSpec[],
  kind: "ref2v" | "i2v",
): { loras: MinimaxLoraSpec[]; engineSuffix: string } {
  if (!EROS_PRODUCTION.enabled) {
    return { loras, engineSuffix: "" };
  }
  if (loras.some((l) => /furry_lora/i.test(l.name))) {
    return { loras, engineSuffix: "+furry_nsfw" };
  }
  const strength =
    kind === "ref2v"
      ? EROS_PRODUCTION.ref2v.furryStrength
      : EROS_PRODUCTION.i2v.furryStrength;
  return {
    loras: [
      ...loras,
      { name: EROS_PRODUCTION.furryLoraName, strength },
    ],
    engineSuffix: "+furry_nsfw",
  };
}
