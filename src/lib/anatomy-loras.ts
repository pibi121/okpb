/** HMPenis + HMPussy MiniMax I2V LoRAs — nude genital close-ups only, never clothed. */

import {
  CUMSHOT_LORA_NAME,
  CUMSHOT_LORA_STRENGTH,
  wantsMaleCumshot,
} from "@/lib/cumshot-lora";

export type MinimaxLoraSpec = { name: string; strength: number };

export const HMPENIS_LORA_NAME = "minimax/HMPenis_v2_e35.safetensors";
export const HMPENIS_TRIGGER = "HMPenis";
export const HMPENIS_STRENGTH = 0.85;

export const VAGASSIST_LORA_NAME = "minimax/vagassist_e40.safetensors";
export const HMPUSSY_LORA_NAME = "minimax/hmpussy_v6_epoch30.safetensors";
export const VAGINA_TRIGGER = "Vagina";
export const HMPUSSY_TRIGGER = "hmpussy";
export const VAGASSIST_STRENGTH = 1.0;
export const HMPUSSY_STRENGTH = 0.35;

const CLOTHED =
  /\bclothed\b|\bdressed\b|\bwearing\b|\bundwear\b|\blingerie\b|\bbikini\b|\bpokies\b|\bpanties\b|\bjeans\b|\bdress\b|\bshirt\b|в одежде|в белье|в платье|в джинсах|в футболке|через одежду/i;

const NUDE_OR_SEX =
  /\bnude\b|\bnaked\b|\bunclothed\b|\bbare\s+(?:skin|pussy|cock|penis)\b|\bpenetration\b|\bthrust|\bintercourse\b|\bfucking\b|\bsex\b|\bcunnilingus\b|\bfellatio\b|голая|голый|голые|обнажен|проникновен|траха|секс/i;

const PENIS =
  /\bpenis\b|\bcocks?\b|\bdicks?\b|\bshaft\b|\bglans\b|\berection\b|пенис|член[ауиеом]?\b|ху[йяюе]\w*|эрекци/i;

const PUSSY =
  /\bpuss(?:y|ies)\b|\bvaginas?\b|\blabia\b|\bclitoris\b|\bcunts?\b|\bvulvas?\b|киск\w*|вагин\w*|половые\s+губы|клитор/i;

export function looksClothedOnly(...texts: Array<string | null | undefined>): boolean {
  const hay = texts.filter(Boolean).join("\n");
  if (!hay.trim()) return false;
  if (NUDE_OR_SEX.test(hay) || PENIS.test(hay) || PUSSY.test(hay)) return false;
  return CLOTHED.test(hay);
}

export function wantsPenisAnatomy(...texts: Array<string | null | undefined>): boolean {
  const hay = texts.filter(Boolean).join("\n");
  if (!hay.trim() || looksClothedOnly(hay)) return false;
  return PENIS.test(hay) || (NUDE_OR_SEX.test(hay) && /\b(?:he|him|his|man|male|boyfriend)\b|мужчин|парень|он\s/i.test(hay));
}

export function wantsPussyAnatomy(...texts: Array<string | null | undefined>): boolean {
  const hay = texts.filter(Boolean).join("\n");
  if (!hay.trim() || looksClothedOnly(hay)) return false;
  return PUSSY.test(hay) || (NUDE_OR_SEX.test(hay) && /\b(?:she|her|woman|female|girlfriend)\b|женщин|девушк|она\s/i.test(hay));
}

function injectTrigger(prompt: string, trigger: string): string {
  const text = prompt.trim();
  if (!text) return `${trigger}.`;
  if (new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) return text;
  const shot = text.match(/(\[Shot\s*1\]\s*)/i);
  if (shot && shot.index != null) {
    const i = shot.index + shot[1].length;
    return `${text.slice(0, i)}${trigger}. ${text.slice(i)}`.replace(/\s{2,}/g, " ");
  }
  return `${trigger}. ${text}`;
}

export function resolveMinimaxLoras(...texts: Array<string | null | undefined>): {
  loras: MinimaxLoraSpec[];
  usePenis: boolean;
  usePussy: boolean;
  useCumshot: boolean;
  engineSuffix: string;
} {
  const usePenis = wantsPenisAnatomy(...texts);
  const usePussy = wantsPussyAnatomy(...texts);
  const useCumshot = wantsMaleCumshot(...texts);
  const loras: MinimaxLoraSpec[] = [];
  const tags: string[] = [];
  if (usePenis) {
    loras.push({ name: HMPENIS_LORA_NAME, strength: HMPENIS_STRENGTH });
    tags.push("penis");
  }
  if (usePussy) {
    loras.push({ name: VAGASSIST_LORA_NAME, strength: VAGASSIST_STRENGTH });
    loras.push({ name: HMPUSSY_LORA_NAME, strength: HMPUSSY_STRENGTH });
    tags.push("pussy");
  }
  if (useCumshot) {
    loras.push({ name: CUMSHOT_LORA_NAME, strength: CUMSHOT_LORA_STRENGTH });
    tags.push("cumshot");
  }
  return {
    loras,
    usePenis,
    usePussy,
    useCumshot,
    engineSuffix: tags.length ? `+${tags.join("+")}` : "",
  };
}

export function applyAnatomyTriggers(
  prompt: string,
  flags: { usePenis: boolean; usePussy: boolean },
): string {
  let out = prompt;
  if (flags.usePenis) out = injectTrigger(out, HMPENIS_TRIGGER);
  if (flags.usePussy) {
    out = injectTrigger(out, `${VAGINA_TRIGGER}, ${HMPUSSY_TRIGGER}`);
  }
  return out;
}

export function anatomyLlmRule(flags: { usePenis: boolean; usePussy: boolean }): string {
  if (!flags.usePenis && !flags.usePussy) {
    return "ANATOMY LORAS: off — do NOT write HMPenis, Vagina, or hmpussy. Scene is clothed or genitals are not the focus.";
  }
  const bits: string[] = ["ANATOMY LORAS: ON — nude genitals visible in Picture 1."];
  if (flags.usePenis) {
    bits.push(`Right after [Shot 1], write trigger ${HMPENIS_TRIGGER} and keep the penis matching the still.`);
  }
  if (flags.usePussy) {
    bits.push(
      `Right after [Shot 1], write triggers ${VAGINA_TRIGGER}, ${HMPUSSY_TRIGGER} and keep the vulva matching the still.`,
    );
  }
  bits.push("Do not invent extra people or change the pose.");
  return bits.join(" ");
}
