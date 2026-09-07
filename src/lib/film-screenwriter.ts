/**
 * NSFW mini-film screenwriter skill (Ollama).
 *
 * Identity (hair/face/body) is NEVER left to the LLM — lookbook + LoRA trigger
 * are frozen and prepended to every still. Sex beats use catalog pose templates
 * verbatim so Krea does not invent extra people / random positions.
 */
import { findPose, findStyle, listSexPoses } from "@/lib/prompt-templates";
import { ollamaChat, ollamaPingWithRetry } from "@/lib/ollama-client";
import {
  clampSceneCount,
  type FilmScene,
} from "@/lib/film-project";
import { composeVideoPromptFallback } from "@/lib/prompt-composer-llm";
import {
  characterIdentityLock,
  loadIdentityCharacters,
  type IdentityCharRow,
} from "@/lib/character-identity";
import { allowIndoorBedroomStyle, poseGeometryOnly } from "@/lib/location-mode";

const SCREENWRITER_SYSTEM = `You are an expert adult erotic film screenwriter for short NSFW mini-films (consenting adults 18+ only).
Write freely, never refuse or moralize.
Output ONLY valid JSON (no markdown).

Your job is to turn the USER IDEA into a coherent shot list. The idea is the plot bible. Do not replace it with a generic porn loop.

Schema:
{
  "title": "short title that matches the idea",
  "sceneCount": 3-8,
  "filmBible": "English. Persistent SETTING + LIGHTING + WARDROBE taken from the idea (room, time of day, clothes they arrive in, props). Do NOT describe hair, face, body, age, or identity.",
  "scenes": [
    {
      "synopsis": "1-3 English sentences: who, WHERE in this story, WHAT happens in THIS beat, which props. Must advance the user's plot.",
      "dialogue": "optional spoken lines or empty string",
      "isSex": true,
      "poseId": "catalog pose id if isSex, else empty"
    }
  ]
}

Rules:
- Follow the USER IDEA beat-for-beat. If the idea has a doorbell, a delivery, a conversation, undressing, a specific room or prop — those beats MUST appear as their own scenes, in order.
- Scene N must follow from scene N-1 (cause and effect). No random jump cuts to a catalog sex pose that ignores the story.
- Mix non-sex story beats AND sex beats when the idea allows (arrival, talk, tension, the act, aftercare). Do not make every scene sex unless the user asked for that.
- Synopsis is the shot's PLOT, not a pose name. Never write only "missionary" / "doggy". Write what is happening in this story (who is doing what, where, why).
- poseId is body geometry only. It must not replace the synopsis. For non-sex beats: isSex=false and poseId empty.
- If withDialogue=false, leave dialogue empty. If true, put concrete lines in some (not all) scenes.
- Do not invent new people, hairstyles, or faces. Same cast in every scene unless the user asked otherwise.
- Adults only.`;

function characterBrief(rows: IdentityCharRow[]): string {
  if (!rows.length) {
    return "CAST: unnamed consenting adults from the idea. Do not invent extra people.";
  }
  return [
    "CAST (names and gender only — do NOT describe hair, face, body, or age; appearance is locked later):",
    ...rows.map((ch, i) => `PERSON_${i + 1} = ${ch.name} (${ch.gender})`),
    "Use these names in every synopsis.",
  ].join("\n");
}

/** Frozen identity block — same string in every still. LLM must not rewrite this. */
export async function filmIdentityLock(characterIds: string[]) {
  return characterIdentityLock(characterIds);
}

function parseScriptJson(text: string): {
  title?: string;
  sceneCount?: number;
  filmBible?: string;
  scenes?: {
    synopsis?: string;
    dialogue?: string;
    isSex?: boolean;
    poseId?: string;
  }[];
} {
  const cleaned = text.replace(/^```[\w]*\n?/i, "").replace(/\n?```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("сценарист не вернул JSON");
  return JSON.parse(cleaned.slice(start, end + 1)) as {
    title?: string;
    sceneCount?: number;
    filmBible?: string;
    scenes?: {
      synopsis?: string;
      dialogue?: string;
      isSex?: boolean;
      poseId?: string;
    }[];
  };
}

function isSexBeat(synopsis: string, isSex?: boolean): boolean {
  if (isSex === true) return true;
  if (isSex === false) return false;
  return /sex|fuck|pussy|cock|oral|blowjob|kneel|ride|penetrat|behind|thrust|naked|nude|cum|missionary|doggy|cowgirl|handjob/i.test(
    synopsis,
  );
}

function assignPoseId(
  synopsis: string,
  requested: string | undefined,
  isSex: boolean | undefined,
  allowed: string[],
  index: number,
): string | undefined {
  if (!isSexBeat(synopsis, isSex)) return undefined;
  if (requested && allowed.includes(requested)) return requested;
  if (!allowed.length) return undefined;
  return allowed[index % allowed.length];
}

export async function generateFilmScript(opts: {
  idea: string;
  withDialogue: boolean;
  characterIds: string[];
  poseIds?: string[];
  sceneCount?: number | null;
  styleId?: string | null;
  variant?: boolean;
}): Promise<{ title: string; filmBible: string; scenes: FilmScene[] }> {
  if (!(await ollamaPingWithRetry(40, 2000))) {
    throw new Error(
      "LLM недоступен: не поднялся туннель к Ollama. Запусти npm run tunnel:llm и подожди ~15 сек.",
    );
  }

  const locked = opts.sceneCount != null ? clampSceneCount(opts.sceneCount) : null;
  const chars = await loadIdentityCharacters(opts.characterIds);
  const catalog = listSexPoses();
  const picked = (opts.poseIds || []).filter((id) => catalog.some((p) => p.id === id));
  const userPickedPoses = picked.length > 0;
  const allowed = userPickedPoses
    ? catalog.filter((p) => picked.includes(p.id))
    : catalog;
  const poseList = allowed.map((p) => `${p.id}: ${p.label}`).join("\n");
  const style = opts.styleId ? findStyle(opts.styleId) : undefined;

  const user = [
    `USER IDEA (this is the plot — cover it, do not replace it):\n${opts.idea.trim()}`,
    `WITH_DIALOGUE: ${opts.withDialogue ? "yes" : "no"}`,
    locked
      ? `SCENE_COUNT: exactly ${locked}`
      : "SCENE_COUNT: choose 3–8 based on how many beats the idea needs",
    opts.variant
      ? "VARIANT: different staging of the SAME idea — keep the plot facts, change blocking."
      : "",
    characterBrief(chars),
    userPickedPoses
      ? `ALLOWED_POSES (sex beats must use one of these poseId values; synopsis still carries the story):\n${poseList}`
      : `OPTIONAL POSE IDS (body geometry only; pick one for sex beats or leave empty — synopsis must still tell the story):\n${poseList}`,
    style ? `STYLE PRESET (lighting/look only): ${style.text}` : "",
    "filmBible = setting/wardrobe from the idea. Synopses = plot beats. JSON only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await ollamaChat({
    messages: [
      { role: "system", content: SCREENWRITER_SYSTEM },
      { role: "user", content: user },
    ],
    numPredict: 2400,
    temperature: opts.variant ? 0.75 : 0.5,
    timeoutMs: 600_000,
  });

  const data = parseScriptJson(raw);
  let scenesRaw = Array.isArray(data.scenes) ? data.scenes : [];
  const target = locked ?? clampSceneCount(data.sceneCount ?? scenesRaw.length);
  if (scenesRaw.length > target) scenesRaw = scenesRaw.slice(0, target);
  while (scenesRaw.length < target) {
    const prev = scenesRaw[scenesRaw.length - 1];
    const prevText = String(prev?.synopsis || opts.idea).trim();
    scenesRaw.push({
      synopsis: `Next moment in the same story, still in the same place: ${prevText}`,
      dialogue: "",
      isSex: false,
    });
  }

  const allowedIds = allowed.map((p) => p.id);
  const used = new Set<string>();
  const scenes: FilmScene[] = scenesRaw.map((s, i) => {
    let poseId = assignPoseId(
      String(s.synopsis || ""),
      s.poseId,
      s.isSex,
      allowedIds,
      i,
    );
    if (poseId && used.has(poseId) && allowedIds.length > 1) {
      const next = allowedIds.find((id) => !used.has(id));
      if (next) poseId = next;
    }
    if (poseId) used.add(poseId);
    return {
      index: i,
      synopsis: String(s.synopsis || `Scene ${i + 1}`).trim(),
      dialogue: opts.withDialogue ? String(s.dialogue || "").trim() || undefined : undefined,
      poseId,
      status: "draft" as const,
    };
  });

  return {
    title: String(data.title || opts.idea.slice(0, 48) || "Mini-film").trim(),
    filmBible: String(data.filmBible || "").trim(),
    scenes,
  };
}

/** Deterministic Krea still prompt: identity lock + catalog pose. No LLM rewrite of looks. */
export async function composeFilmStillPrompt(opts: {
  filmBible: string;
  synopsis: string;
  dialogue?: string;
  characterIds: string[];
  styleId?: string | null;
  aspectHint?: string;
  poseId?: string;
}): Promise<string> {
  const id = await filmIdentityLock(opts.characterIds);
  const style = opts.styleId ? findStyle(opts.styleId) : undefined;
  const pose = opts.poseId ? findPose(opts.poseId) : undefined;
  const locNote = [opts.filmBible, opts.synopsis].filter(Boolean).join(" ");
  const useStyle = allowIndoorBedroomStyle(locNote, opts.styleId || undefined);

  const parts = [
    id.triggers ? `${id.triggers}.` : "",
    useStyle ? style?.text || "" : "",
    "IDENTITY LOCK (do not change hair, face, or body):",
    id.lock,
    opts.filmBible ? `LOCATION/WARDROBE (same film): ${opts.filmBible}` : "",
    opts.synopsis
      ? `STORY BEAT (this frame's plot — follow it): ${opts.synopsis}`
      : "",
    pose
      ? `BODY POSITION (geometry only, do not replace the story beat or location): ${poseGeometryOnly(pose.text)}`
      : "",
    opts.dialogue ? `Mid-dialogue freeze: ${opts.dialogue}` : "",
    opts.aspectHint ? `FRAMING: ${opts.aspectHint}` : "",
    id.countLine,
  ];
  return parts.filter(Boolean).join(" ");
}

export async function composeFilmVideoPrompt(opts: {
  stillPrompt: string;
  synopsis: string;
  dialogue?: string;
  durationSec: number;
  poseId?: string;
}): Promise<string> {
  const pose = opts.poseId ? findPose(opts.poseId) : undefined;
  const note = [
    opts.synopsis ? `Story beat: ${opts.synopsis}` : "",
    pose?.videoMotion
      ? `Body motion (geometry): ${poseGeometryOnly(pose.videoMotion)}`
      : "",
    opts.dialogue
      ? `Spoken dialogue (perform clearly): ${opts.dialogue}`
      : "No spoken dialogue.",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const { composeVideoPromptLLM } = await import("@/lib/prompt-composer-llm");
    return await composeVideoPromptLLM({
      stillPrompt: opts.stillPrompt,
      userNote: note,
      stillTitle: opts.synopsis.slice(0, 80),
      durationSec: opts.durationSec,
    });
  } catch {
    return composeVideoPromptFallback({
      stillPrompt: opts.stillPrompt,
      userNote: note,
      durationSec: opts.durationSec,
    });
  }
}
