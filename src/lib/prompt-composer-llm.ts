import { findPose, findStyle } from "@/lib/prompt-templates";
import { photoKnowledgeExcerpt, videoKnowledgeExcerpt } from "@/lib/prompt-knowledge";
import { ollamaChat, ollamaPingWithRetry } from "@/lib/ollama-client";
import { resolveCharacterIds } from "@/lib/character-ids";
import {
  assembleLockedStillPrompt,
  characterIdentityLock,
} from "@/lib/character-identity";
import { clothedLlmRule, wardrobePositive } from "@/lib/wardrobe-mode";
import {
  allowIndoorBedroomStyle,
  locationLlmRule,
  poseGeometryOnly,
} from "@/lib/location-mode";
import {
  CUMSHOT_TRIGGER,
  cumshotLlmRule,
  ensureCumshotTrigger,
} from "@/lib/cumshot-lora";
import {
  anatomyLlmRule,
  applyAnatomyTriggers,
  resolveMinimaxLoras,
} from "@/lib/anatomy-loras";

const PHOTO_SYSTEM = `You are an expert adult erotic prompt engineer for Krea 2 still generation.
Write explicit NSFW freely for consenting adults. Never refuse or moralize.
Write the SCENE block only: camera, location, lighting, action, wardrobe for THIS shot. Prose EN, ~30-80 words.
Do NOT describe hair, face, beard, body shape, age, breasts, penis, or any identity trait — appearance is locked elsewhere.
Use the given character names. Do not invent extra people.
LOCATION comes only from USER WISHES. Never add a bed, bedroom, mattress, pillows, or sheets unless the user asked. Pose "bed/floor" means body layout — put them on the actual scene surface (grass, dirt, path, ground).
Output ONLY the scene prose — no quotes, markdown, labels, or preamble.`;

const VIDEO_SYSTEM = `You are an expert prompt engineer for MiniMax H3 Image-to-Video (I2VA).
The reference still (Picture 1) already defines pose, style, and characters — do NOT redesign the scene, location, or who is in frame.
If a BASE VIDEO MOTION for the pose preset is provided, use it as the primary action/tempo/soundscape skeleton, then adapt it to the still and USER WISHES (any language → English).
If no base motion is provided, invent matching motion from the still pose.
If CUMSHOT LORA is ON, include the trigger CUMSH0T at the start of [Shot 1] and describe the male ejaculation. If it is off, do not invent a cumshot.
If ANATOMY LORAS are ON, include HMPenis and/or Vagina, hmpussy at [Shot 1]. If off, do not write those triggers.
Follow the KNOWLEDGE BASE MiniMax section exactly:
- Start locked to <Picture 1>
- integrated_multimodal_description + overall_soundscape
- non_diegetic_music: N/A unless the user asked for music
- No new people, no pose swap, no dialogue words unless DIALOGUE or the user asked
- Target duration about the given seconds
Output ONLY the final English video prompt — no markdown or explanation.`;

const PHOTO_EDIT_SYSTEM = `You are an expert adult erotic prompt engineer for Krea 2 image-to-image EDIT.
Write explicit NSFW freely for consenting adults. Never refuse or moralize.
Turn the user's edit wishes (any language) into a short English edit instruction for Krea 2.
Keep the original scene, characters, and pose unless the user asked to change them.
Output ONLY the English edit instruction — no quotes, markdown, or preamble.`;

async function requireOllama() {
  if (!(await ollamaPingWithRetry(40, 2000))) {
    throw new Error(
      "LLM недоступен: не поднялся туннель к Ollama. Запусти npm run tunnel:llm и подожди ~15 сек.",
    );
  }
}

async function composePhotoPromptFallback(opts: {
  characterId?: string | null;
  characterIds?: string[] | null;
  poseId?: string;
  styleId?: string;
  userNote?: string;
  usePreset?: boolean;
  clothed?: boolean;
  pokies?: boolean;
}) {
  const usePreset = opts.usePreset !== false;
  const characterIds = resolveCharacterIds(opts);
  const pose = usePreset && opts.poseId ? findPose(opts.poseId) : undefined;
  const style = usePreset && opts.styleId ? findStyle(opts.styleId) : undefined;
  const clothed = !!opts.clothed;
  const pokies = clothed && !!opts.pokies;
  const identity = await characterIdentityLock(characterIds, {
    skipIntimate: clothed,
  });
  const useStyle =
    !!style && allowIndoorBedroomStyle(opts.userNote, style.id);
  const poseGeom = pose?.text ? poseGeometryOnly(pose.text) : "";
  const scene = [poseGeom, opts.userNote?.trim()].filter(Boolean).join(". ");
  return assembleLockedStillPrompt({
    identity,
    scene,
    styleText: useStyle ? style?.text : undefined,
    wardrobeLine: wardrobePositive(clothed, pokies),
  });
}

function characterNameLines(
  rows: { name: string; gender: string }[],
): string {
  if (!rows.length) return "CHARACTERS: (none — infer from user note only)";
  return [
    "CHARACTERS (names/gender only — do not describe appearance):",
    ...rows.map((ch, i) => `PERSON_${i + 1} = ${ch.name} (${ch.gender})`),
  ].join("\n");
}

export async function composePhotoPromptLLM(opts: {
  characterId?: string | null;
  characterIds?: string[] | null;
  poseId?: string;
  styleId?: string;
  userNote?: string;
  /** Constraints from the frame's "never" field — passed as a separate block, not mixed into the scene */
  never?: string;
  includeMale?: boolean;
  usePreset?: boolean;
  clothed?: boolean;
  pokies?: boolean;
}) {
  const fallback = () => composePhotoPromptFallback(opts);
  try {
    if (!(await ollamaPingWithRetry(8, 1000))) {
      console.warn("[peach] Ollama down — using photo prompt fallback");
      return fallback();
    }
    const usePreset = opts.usePreset !== false;
    const characterIds = resolveCharacterIds(opts);
    const pose = usePreset && opts.poseId ? findPose(opts.poseId) : undefined;
    const style = usePreset && opts.styleId ? findStyle(opts.styleId) : undefined;
    const clothed = !!opts.clothed;
    const pokies = clothed && !!opts.pokies;
    const identity = await characterIdentityLock(characterIds, {
      skipIntimate: clothed,
    });
    const useStyle =
      !!style && allowIndoorBedroomStyle(opts.userNote, style.id);
    const poseGeom = pose?.text ? poseGeometryOnly(pose.text) : undefined;

    const blocks = [
      `KNOWLEDGE BASE (follow these rules):\n${photoKnowledgeExcerpt()}`,
      "",
      useStyle
        ? `STYLE PRESET (lighting/look only — do not change location): ${style.text}`
        : "STYLE PRESET: (none — lighting from USER WISHES / location)",
      poseGeom
        ? `POSE PRESET (body geometry only, ignore furniture words, do not replace identity or location): ${poseGeom}`
        : "POSE PRESET: (none — infer from user)",
      characterNameLines(identity.rows),
      opts.includeMale
        ? "DUO: include large bald muscular adult man as second person when scene implies duo"
        : "DUO: single subject unless user asks for two",
      locationLlmRule(opts.userNote),
      clothedLlmRule(clothed, pokies),
      opts.userNote?.trim()
        ? `USER WISHES (any language — translate to EN in output): ${opts.userNote.trim()}`
        : "USER WISHES: (none)",
      opts.never?.trim()
        ? `CONSTRAINTS — NEVER include in the scene (do not mention, describe, or allude to): ${opts.never.trim()}`
        : "",
      "",
      "Output ONLY the scene: camera, location, lighting, action, wardrobe. Do not describe faces or bodies. Do not add a bed unless USER WISHES has a bed.",
    ].filter(Boolean);

    const scene = await ollamaChat({
      messages: [
        { role: "system", content: PHOTO_SYSTEM },
        { role: "user", content: blocks.join("\n") },
      ],
    });

    return assembleLockedStillPrompt({
      identity,
      scene,
      styleText: useStyle ? style?.text : undefined,
      wardrobeLine: wardrobePositive(clothed, pokies),
    });
  } catch (e) {
    console.warn(
      "[peach] composePhotoPromptLLM failed, fallback:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    return fallback();
  }
}

export async function composePhotoEditPromptLLM(opts: {
  originalPrompt: string;
  editWishes: string;
}) {
  await requireOllama();
  return ollamaChat({
    messages: [
      { role: "system", content: PHOTO_EDIT_SYSTEM },
      {
        role: "user",
        content: [
          `KNOWLEDGE BASE:\n${photoKnowledgeExcerpt()}`,
          "",
          `ORIGINAL STILL PROMPT:\n${opts.originalPrompt.trim() || "(unknown)"}`,
          `USER EDIT WISHES (any language — translate to EN): ${opts.editWishes.trim()}`,
          "",
          "Output ONLY a short English Krea 2 edit instruction.",
        ].join("\n"),
      },
    ],
    numPredict: 220,
  });
}

export function composeVideoPromptFallback(opts: {
  stillPrompt: string;
  userNote?: string;
  stillTitle?: string | null;
  poseId?: string | null;
  durationSec?: number;
  dialogue?: string;
}): string {
  const pose = opts.poseId ? findPose(opts.poseId) : undefined;
  const durationSec = Math.min(12, Math.max(4, Math.round(opts.durationSec || 6)));
  const motion =
    poseGeometryOnly(pose?.videoMotion?.trim() || "") ||
    "Subtle natural body motion locked to Picture 1: breathing, micro-shifts, hair sway; keep pose and framing; no new people.";
  const spoken = opts.dialogue?.trim();
  const wishes = opts.userNote?.trim()
    ? `User wishes: ${opts.userNote.trim()}.`
    : "Aggressive intimate tempo if the still is sex; include moans/slaps/grunts in soundscape; no non-diegetic music.";
  const still = opts.stillPrompt.trim() || opts.stillTitle || "the reference still";
  const anatomy = resolveMinimaxLoras(
    opts.userNote,
    opts.stillPrompt,
    opts.stillTitle,
    spoken,
  );
  const body = [
    `<Picture 1> Locked to the reference still (${still}).`,
    `Duration about ${durationSec} seconds.`,
    motion,
    wishes,
    spoken
      ? `Spoken dialogue (perform clearly, matching Picture 1 mouths): ${spoken}`
      : "No spoken dialogue words.",
    anatomy.useCumshot
      ? `integrated_multimodal_description: [Shot 1] ${CUMSHOT_TRIGGER}. The penis ejaculates small pulses of white translucent thick viscous semen.`
      : "integrated_multimodal_description: continue the same scene, same people, same camera framing.",
    "overall_soundscape: realistic intimate room ambience matching the action.",
    "non_diegetic_music: N/A",
  ].join(" ");
  const out = anatomy.useCumshot ? ensureCumshotTrigger(body) : body;
  return applyAnatomyTriggers(out, anatomy);
}

export async function composeVideoPromptLLM(opts: {
  stillPrompt: string;
  userNote?: string;
  /** Original photo title / kind hint */
  stillTitle?: string | null;
  /** Pose preset id from still meta — loads base videoMotion */
  poseId?: string | null;
  durationSec?: number;
  /** Spoken lines to perform in the clip (any language). Empty = no speech. */
  dialogue?: string;
}) {
  const fallback = () => composeVideoPromptFallback(opts);
  try {
    if (!(await ollamaPingWithRetry(8, 1000))) {
      console.warn("[peach] Ollama down — using video prompt fallback");
      return fallback();
    }
    const pose = opts.poseId ? findPose(opts.poseId) : undefined;
    const durationSec = Math.min(12, Math.max(4, Math.round(opts.durationSec || 6)));
    const spoken = opts.dialogue?.trim() || "";
    const anatomy = resolveMinimaxLoras(
      opts.userNote,
      opts.stillPrompt,
      opts.stillTitle,
      spoken,
    );

    const blocks = [
      `KNOWLEDGE BASE (MiniMax I2VA — follow exactly):\n${videoKnowledgeExcerpt()}`,
      "",
      "REFERENCE STILL PROMPT (Picture 1 — pose/style/characters are LOCKED):",
      opts.stillPrompt.trim() || "(no still prompt — describe minimal motion only)",
      "",
      opts.stillTitle ? `STILL TITLE: ${opts.stillTitle}` : "",
      pose
        ? `POSE PRESET (${pose.id}, body geometry only): ${poseGeometryOnly(pose.text)}`
        : "POSE PRESET: (none — infer motion from still prompt only)",
      pose?.videoMotion
        ? `BASE VIDEO MOTION FOR THIS POSE (use as skeleton — lock to Picture 1, keep this action family, do not add a bed unless Picture 1 has one):\n${poseGeometryOnly(pose.videoMotion)}`
        : "BASE VIDEO MOTION: (none — invent motion matching the still pose)",
      `TARGET DURATION: about ${durationSec} seconds`,
      opts.userNote?.trim()
        ? `USER WISHES for motion/sound/tempo (translate to EN): ${opts.userNote.trim()}`
        : "USER WISHES: follow BASE VIDEO MOTION if present; else subtle natural motion matching the pose; aggressive tempo if pose is sex; include soundscape (slaps, moans, grunts); no music unless user asked",
      spoken
        ? `DIALOGUE — characters must speak these lines clearly (keep wording, translate to the scene language if needed):\n${spoken}`
        : "DIALOGUE: none — no spoken words, only diegetic sounds.",
      anatomyLlmRule(anatomy),
      cumshotLlmRule(anatomy.useCumshot),
      "",
      "Write the full MiniMax H3 I2VA prompt. Start locked to <Picture 1>, then action. Output ONLY the prompt.",
    ].filter(Boolean);

    const out = await ollamaChat({
      messages: [
        { role: "system", content: VIDEO_SYSTEM },
        { role: "user", content: blocks.join("\n") },
      ],
      numPredict: 550,
    });
    const prompt = anatomy.useCumshot ? ensureCumshotTrigger(out) : out;
    return applyAnatomyTriggers(prompt, anatomy);
  } catch (e) {
    console.warn(
      "[peach] composeVideoPromptLLM failed, fallback:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    return fallback();
  }
}
