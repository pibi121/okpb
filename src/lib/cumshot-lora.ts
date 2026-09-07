/** Epic Cumshots LoRA for MiniMax H3 — male orgasm / ejaculation only. */

export const CUMSHOT_LORA_NAME =
  "minimax/epic_cumshots-MiniMaxH3-ALPHA-CUMSH0T.safetensors";

/** Trigger from the CivitAI ALPHA file name / sample prompts. */
export const CUMSHOT_TRIGGER = "CUMSH0T";

export const CUMSHOT_LORA_STRENGTH = 1.0;

const STRONG_EJACULATION =
  /\bcum[\s-]?shots?\b|\bcumsh0t\b|\bejaculat(?:e|es|ed|ing|ion)?\b|\bsemen\b|\bsperm\b|\bcreampies?\b|\bmoney[\s-]?shot\b|\bfacial[\s-]?cums?\b|\bropes?\s+of\s+(?:cum|semen)\b|\bshooting\s+(?:cum|semen|ropes)\b|\bloads?\s+of\s+(?:cum|semen)\b|камшот|сперма\w*|сперм[аыуеой]?|облив\w*\s+сперма/i;

const MALE_CLIMAX =
  /\b(?:he|him|his|man|male|boyfriend|husband)\b[\s\S]{0,48}\b(?:cums?|cumming|orgasms?|climaxes?)\b|\b(?:cums?|cumming|orgasms?|climaxes?)\b[\s\S]{0,48}\b(?:he|him|his|man|male)\b|\bhe\s+(?:is\s+)?(?:cumming|ejaculating)\b|он\s+конч\w*|мужчин\w*\s+конч\w*|его\s+оргазм|кончает\s+(?:в|на|ей|ему)/i;

const FEMALE_ONLY_CLIMAX =
  /\b(?:she|her|woman|female|girlfriend|wife)\b[\s\S]{0,48}\b(?:cums?|cumming|orgasms?|climaxes?)\b|она\s+конч\w*|её\s+оргазм|ее\s+оргазм|женский\s+оргазм/i;

export function wantsMaleCumshot(...texts: Array<string | null | undefined>): boolean {
  const hay = texts.filter(Boolean).join("\n");
  if (!hay.trim()) return false;
  if (STRONG_EJACULATION.test(hay)) return true;
  if (MALE_CLIMAX.test(hay)) return true;
  if (FEMALE_ONLY_CLIMAX.test(hay)) return false;
  return false;
}

export function ensureCumshotTrigger(prompt: string): string {
  const text = prompt.trim();
  if (!text) {
    return `${CUMSHOT_TRIGGER}. The penis ejaculates small pulses of white translucent thick viscous semen.`;
  }
  if (new RegExp(`\\b${CUMSHOT_TRIGGER}\\b`, "i").test(text)) return text;

  const shot = text.match(/(\[Shot\s*1\]\s*)/i);
  if (shot && shot.index != null) {
    const i = shot.index + shot[1].length;
    return `${text.slice(0, i)}${CUMSHOT_TRIGGER}. ${text.slice(i)}`.replace(/\s{2,}/g, " ");
  }
  return `${CUMSHOT_TRIGGER}. ${text}`;
}

export function cumshotLlmRule(active: boolean): string {
  if (!active) {
    return "CUMSHOT LORA: off — do NOT write CUMSH0T, ejaculation, semen pulses, or a male climax unless USER WISHES ask for it.";
  }
  return [
    "CUMSHOT LORA: ON — male orgasm in this shot.",
    `Right after the Picture 1 lock / [Shot 1], write the trigger word ${CUMSHOT_TRIGGER}.`,
    "Then describe the penis ejaculating small pulses of white translucent thick viscous semen, landing where the scene implies (face, mouth, chest, inside, etc.).",
    "Keep the still pose and people. Do not skip the climax.",
  ].join(" ");
}
