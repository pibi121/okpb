/** Sex LoRA A/B packs for MiniMax Ref2V (not anatomy HMPenis stack). */

import type { MinimaxLoraSpec } from "@/lib/anatomy-loras";

export const HMNSFW_AIO_LORA_NAME = "minimax/HMNSFW_AIO_V2.safetensors";
export const HMNSFW_AIO_TRIGGER = "hmmotion";
export const HMNSFW_AIO_STRENGTH = 0.85;

export const FURRY_NSFW_LORA_NAME = "minimax/furry_lora_epoch31.safetensors";
/** Pack default for A/B scripts. Production Ref2V/I2V strengths live in eros-production.ts. */
export const FURRY_NSFW_STRENGTH = 0.85;

export type SexLoraMode = "hmnsfw_aio" | "furry_nsfw" | "hmnsfw_aio+furry";

export function resolveSexLoraPack(mode: SexLoraMode): {
  loras: MinimaxLoraSpec[];
  triggers: string[];
  label: string;
  engineSuffix: string;
} {
  if (mode === "hmnsfw_aio") {
    return {
      loras: [{ name: HMNSFW_AIO_LORA_NAME, strength: HMNSFW_AIO_STRENGTH }],
      triggers: [HMNSFW_AIO_TRIGGER],
      label: "HMNSFW AIO V2",
      engineSuffix: "+hmnsfw_aio",
    };
  }
  if (mode === "furry_nsfw") {
    return {
      loras: [{ name: FURRY_NSFW_LORA_NAME, strength: FURRY_NSFW_STRENGTH }],
      triggers: [],
      label: "H3 NSFW furry e31",
      engineSuffix: "+furry_nsfw",
    };
  }
  return {
    loras: [
      { name: HMNSFW_AIO_LORA_NAME, strength: 0.75 },
      { name: FURRY_NSFW_LORA_NAME, strength: 0.75 },
    ],
    triggers: [HMNSFW_AIO_TRIGGER],
    label: "HMNSFW AIO + furry e31",
    engineSuffix: "+hmnsfw_aio+furry",
  };
}

export function injectTriggers(prompt: string, triggers: string[]): string {
  let out = prompt.trim();
  for (const trigger of triggers) {
    if (!trigger) continue;
    if (new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(out)) {
      continue;
    }
    const shot = out.match(/(\[Shot\s*1\]\s*)/i);
    if (shot && shot.index != null) {
      const i = shot.index + shot[1].length;
      out = `${out.slice(0, i)}${trigger}. ${out.slice(i)}`.replace(/\s{2,}/g, " ");
    } else {
      out = `${trigger}. ${out}`;
    }
  }
  return out;
}
