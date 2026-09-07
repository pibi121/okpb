/**
 * MiniMax H3 Full-Reference story prompts (from Grok) for Ref2V.
 * Keeps Grok's summary / retention / detailed_description / soundscape,
 * but rebuilds subject_definitions from Peach picture slots so identity
 * always maps to the user's photos (Picture 1–3, etc.).
 */
import {
  effectivePictureIndex,
  normalizeRefPrompt,
  remapPictureTags,
  roleDefHint,
  slotRoleOf,
  type QuickVideoImageSlot,
  type QuickVideoSlotRole,
} from "@/lib/quick-video-prompt";
import { finalizePromptSpeechForModel } from "@/lib/speech-slots";

const SECTION_KEYS = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
] as const;

export type StoryH3TemplateStored = {
  __storyH3: 1;
  prompt: string;
  totalDurationSec: number;
  /** Default body/bust/hips ids for the Story lab form (not baked identity). */
  bodyLookbook?: Record<string, string>;
};

export function serializeStoryH3Template(opts: {
  prompt: string;
  totalDurationSec: number;
  bodyLookbook?: Record<string, string>;
}): string {
  const payload: StoryH3TemplateStored = {
    __storyH3: 1,
    prompt: opts.prompt.trim(),
    totalDurationSec: Math.min(
      12,
      Math.max(4, Math.floor(opts.totalDurationSec) || 8),
    ),
  };
  if (opts.bodyLookbook && Object.keys(opts.bodyLookbook).length) {
    payload.bodyLookbook = opts.bodyLookbook;
  }
  return JSON.stringify(payload);
}

export function parseStoryH3Template(
  raw: string,
): StoryH3TemplateStored | null {
  const text = raw.trim();
  if (!text.startsWith('{"__storyH3"')) return null;
  try {
    const j = JSON.parse(text) as Partial<StoryH3TemplateStored>;
    if (j.__storyH3 !== 1 || typeof j.prompt !== "string") return null;
    const prompt = j.prompt.trim();
    if (prompt.length < 40) return null;
    return {
      __storyH3: 1,
      prompt,
      totalDurationSec: Math.min(
        12,
        Math.max(4, Math.floor(Number(j.totalDurationSec)) || 8),
      ),
      bodyLookbook:
        j.bodyLookbook && typeof j.bodyLookbook === "object"
          ? (j.bodyLookbook as Record<string, string>)
          : undefined,
    };
  } catch {
    return null;
  }
}

/** True when run.prompt is a Story H3 dump (not LEGO shots JSON). */
export function isStoryH3RunPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (parseStoryH3Template(text)) return true;
  if (text.startsWith('{"__qvShots"')) return false;
  if (text.startsWith("{")) return false;
  return storyH3LooksStructured(text) || text.length >= 80;
}

function splitH3Sections(raw: string): Record<string, string> {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const out: Record<string, string> = {};
  if (!text) return out;

  const re =
    /^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:\s*$/gim;
  const matches = [...text.matchAll(re)];
  if (!matches.length) {
    out.detailed_description = text;
    return out;
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const key = m[1]!.toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    out[key] = text.slice(start, end).trim();
  }
  return out;
}

function bodyClause(slot: QuickVideoImageSlot): string {
  const hint = slot.bodyShapeHint?.trim();
  if (!hint) return "";
  return ` CRITICAL BODY OVERRIDE (not from photo): force body proportions to ${hint}. Do not copy breast size, hip size, or butt size from this picture if they conflict — text body settings win.`;
}

function buildSlotDefinitions(
  imageSlots: QuickVideoImageSlot[],
  remap?: Map<number, number>,
): string[] {
  return imageSlots.map((slot, i) => {
    const n = effectivePictureIndex(slot.pictureIndex ?? i + 1, remap);
    const role = slotRoleOf(slot);
    if (role === "identity") {
      const who =
        slot.characterName?.trim() || slot.label?.trim() || `Subject ${n}`;
      return `<Picture ${n}> is ${who}'s identity reference for FACE, HAIR, and SKIN ONLY. Preserve recognizable facial identity, hair, and skin from this picture.${bodyClause(slot)} Do not invent a different face.`;
    }
    if (role === "location") {
      const label = slot.label?.trim();
      return `<Picture ${n}> is the mandatory environment/location reference${label ? ` (${label})` : ""} — match outdoor/indoor setting, architecture, scenery, weather and lighting. Do not treat this picture as identity.`;
    }
    const hint = slot.label?.trim() || roleDefHint(role as QuickVideoSlotRole);
    return `<Picture ${n}> is the ${hint}.`;
  });
}

function patchRetentionForIdentity(
  retention: string,
  bodyHints: string[],
): string {
  const base = retention.trim();
  const bodyExtra = bodyHints.length
    ? ` BODY SHAPE LOCK (mandatory): ${bodyHints.join("; ")} — overrides any larger/smaller body cues in pictures or shot text.`
    : "";
  const identityLine =
    `<Picture 1> / identity subject (throughout): fully_preserved — facial identity, hairstyle, age cues, and skin from the identity reference pictures remain recognizable and stable.${bodyExtra}`;
  if (!base) return identityLine;
  // Always append body lock even if Grok already wrote fully_preserved.
  if (bodyHints.length && !/BODY SHAPE LOCK/i.test(base)) {
    return `${base}\nBODY SHAPE LOCK (mandatory): ${bodyHints.join("; ")} — overrides any conflicting body size in pictures or shot text.`;
  }
  if (/fully_preserved/i.test(base) && /identity|Picture\s*1|Subject\s*1/i.test(base)) {
    return base;
  }
  return `${identityLine}\n${base}`;
}

function bodyShapeLockBlock(bodyHints: string[]): string {
  if (!bodyHints.length) return "";
  return `body_shape_lock:
MANDATORY body proportions for Subject 1 throughout every shot: ${bodyHints.join("; ")}.
This overrides breast/hip/butt size implied by identity photos and any conflicting body description in detailed_description.
Keep face/hair/skin from <Picture 1–3>; force body shape from this lock only.`;
}

/**
 * Compose final Ref2V prompt from a Grok H3 dump + filled Peach slots.
 */
export function prepareStoryH3Prompt(
  userPrompt: string,
  imageSlots: QuickVideoImageSlot[],
  videoCount = 0,
  opts?: { pictureRemap?: Map<number, number> },
): string {
  let raw = normalizeRefPrompt(userPrompt.trim());
  if (opts?.pictureRemap?.size) {
    raw = remapPictureTags(raw, opts.pictureRemap);
  }

  const sections = splitH3Sections(raw);
  const defs = buildSlotDefinitions(imageSlots, opts?.pictureRemap);
  const bodyHints = [
    ...new Set(
      imageSlots
        .filter((s) => slotRoleOf(s) === "identity")
        .map((s) => s.bodyShapeHint?.trim())
        .filter(Boolean) as string[],
    ),
  ];

  const parts: string[] = [];

  if (defs.length) {
    parts.push(`subject_definitions:\n${defs.join("\n")}`);
  } else if (sections.subject_definitions) {
    parts.push(`subject_definitions:\n${sections.subject_definitions}`);
  }

  const lock = bodyShapeLockBlock(bodyHints);
  if (lock) parts.push(lock);

  if (videoCount > 0) {
    parts.push(
      "motion_reference:\nMatch poses, body motion, camera moves and timing from <Video 1> unless the prompt explicitly overrides. Identity still comes from the identity picture slots, not from the video faces.",
    );
  }

  let summary =
    sections.summary?.trim() ||
    "[reference generation] Generate the target video with the identity subject fully preserved from the identity reference pictures, following the staged actions and camera plan in detailed_description.";
  if (bodyHints.length && !/BODY SHAPE LOCK|body proportions/i.test(summary)) {
    summary = `${summary} BODY SHAPE LOCK: ${bodyHints.join("; ")}.`;
  }
  parts.push(`summary:\n${summary}`);

  parts.push(
    `retention_analysis:\n${patchRetentionForIdentity(sections.retention_analysis || "", bodyHints)}`,
  );

  let detailed =
    sections.detailed_description?.trim() ||
    (sections.subject_definitions || sections.summary ? "" : raw);
  if (detailed && bodyHints.length) {
    detailed = `BODY SHAPE LOCK (apply in every shot, overrides conflicting body size words below): ${bodyHints.join("; ")}.\n\n${detailed}`;
  }
  if (detailed) {
    parts.push(`detailed_description:\n${detailed}`);
  }

  if (sections.overall_soundscape?.trim()) {
    parts.push(`overall_soundscape:\n${sections.overall_soundscape.trim()}`);
  }

  if (sections.non_diegetic_music?.trim()) {
    parts.push(`non_diegetic_music:\n${sections.non_diegetic_music.trim()}`);
  } else {
    parts.push("non_diegetic_music:\nN/A");
  }

  return finalizePromptSpeechForModel(parts.join("\n\n").trim());
}

export function storyH3LooksStructured(prompt: string): boolean {
  const s = splitH3Sections(prompt);
  return Boolean(
    s.detailed_description ||
      (s.summary && s.retention_analysis) ||
      SECTION_KEYS.some((k) => (s[k] || "").length > 40),
  );
}
