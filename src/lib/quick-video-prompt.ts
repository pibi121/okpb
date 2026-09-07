/**
 * Normalize user prompt refs for MiniMax Ref2V:
 * [image N] / <Picture N> tags + subject_definitions from slots.
 */
import {
  analyzeLegoTokens,
  buildVideoLegoCatalog,
  parseLegoQuery,
  type LegoCatalogItem,
  type LegoCharacterRef,
  type VideoLegoFile,
} from "@/lib/prompt-lego-core";
import type { TemplatePose } from "@/lib/prompt-templates";

export const MAX_QUICK_VIDEO_PICTURES = 9;
export const MIN_QUICK_VIDEO_SHOT_SEC = 1;
export const MAX_QUICK_VIDEO_TOTAL_SEC = 12;
export const MIN_QUICK_VIDEO_TOTAL_SEC = 4;

/** Fixed layout: Picture 1–3 identity, Picture 4 location, Picture 5+ optional. */
export const IDENTITY_SLOT_COUNT = 3;
export const LOCATION_SLOT_INDEX = 4;
export const DEFAULT_ANATOMY_SLOT_INDEX = 5;
export const EXTRA_SLOT_START = 5;
export const MIN_QUICK_VIDEO_SLOTS = 4;
/** Legacy video LEGO presets hardcode penis ref as Picture 4 — remap when anatomy slot is set. */
export const PRESET_ANATOMY_PICTURE_INDEX = 4;

export type QuickVideoShotInput = {
  id?: string;
  durationSec: number;
  legoQuery: string;
};

export type QuickVideoShotsPlan = {
  totalDurationSec: number;
  shots: QuickVideoShotInput[];
};

export type QuickVideoShotSegment = {
  index: number;
  startSec: number;
  endSec: number;
  description: string;
  soundscape: string;
};

export type QuickVideoLegoContext = {
  catalog: LegoCatalogItem[];
  characters: LegoCharacterRef[];
  poses?: TemplatePose[];
};

export type QuickVideoSlotRole =
  | "identity"
  | "location"
  | "pose"
  | "object"
  | "anatomy"
  | "other";

export type QuickVideoImageSlot = {
  kind: QuickVideoSlotRole | "identity" | "extra";
  role?: QuickVideoSlotRole;
  characterName?: string;
  label?: string;
  /** 1-based Picture index as shown in UI / prompt. */
  pictureIndex?: number;
  /** Lookbook body/bust/hips clause for Ref2V identity (face stays from photo). */
  bodyShapeHint?: string;
};

export const SLOT_ROLE_OPTIONS: Array<{
  id: QuickVideoSlotRole;
  label: string;
  defHint: string;
}> = [
  {
    id: "identity",
    label: "Личность / лицо",
    defHint: "identity reference (face, body, hair, skin)",
  },
  {
    id: "location",
    label: "Локация",
    defHint: "location / environment reference",
  },
  {
    id: "pose",
    label: "Поза / композиция",
    defHint: "pose and body composition reference",
  },
  {
    id: "object",
    label: "Объект / реквизит",
    defHint: "object or prop reference",
  },
  {
    id: "anatomy",
    label: "Гениталии / анатомия",
    defHint: "anatomy / genital detail reference",
  },
  {
    id: "other",
    label: "Другое",
    defHint: "scene element as described in the prompt",
  },
];

const EXTRA_DEFAULT_ROLES: QuickVideoSlotRole[] = [
  "anatomy",
  "pose",
  "object",
  "other",
  "other",
];

export function fixedSlotRoleForIndex(slotIndex: number): QuickVideoSlotRole {
  if (slotIndex < IDENTITY_SLOT_COUNT) return "identity";
  if (slotIndex === LOCATION_SLOT_INDEX - 1) return "location";
  return EXTRA_DEFAULT_ROLES[slotIndex - (EXTRA_SLOT_START - 1)] || "other";
}

export function isReservedSlotIndex(slotIndex: number): boolean {
  return slotIndex < EXTRA_SLOT_START - 1;
}

export const EXTRA_SLOT_ROLE_OPTIONS = SLOT_ROLE_OPTIONS.filter(
  (r) => r.id !== "identity" && r.id !== "location",
);

export function roleDefHint(role: QuickVideoSlotRole): string {
  return (
    SLOT_ROLE_OPTIONS.find((r) => r.id === role)?.defHint ||
    "scene element as described in the prompt"
  );
}

export function normalizeRefPrompt(userPrompt: string): string {
  let p = userPrompt.trim();
  p = p.replace(/\[image\s*#?\s*(\d+)\]/gi, "<Picture $1>");
  p = p.replace(/\[ref\s*#?\s*(\d+)\]/gi, "<Picture $1>");
  p = p.replace(/\[picture\s*#?\s*(\d+)\]/gi, "<Picture $1>");
  p = p.replace(/\[video\s*#?\s*(\d+)\]/gi, "<Video $1>");
  return p;
}

/**
 * If UI slots were compacted (gaps removed), rewrite <Picture old> → <Picture new>.
 * mapping: oldIndex(1-based) → newIndex(1-based).
 */
export function remapPictureTags(
  prompt: string,
  mapping: Map<number, number>,
): string {
  if (!mapping.size) return prompt;
  let out = prompt.replace(/<Picture\s+(\d+)>/gi, (full, n) => {
    const oldN = Number(n);
    const neu = mapping.get(oldN);
    if (!neu || neu === oldN) return full;
    return `<Picture ${neu}>`;
  });
  out = out.replace(/\bPicture\s+(\d+)\b/gi, (full, n) => {
    const oldN = Number(n);
    const neu = mapping.get(oldN);
    if (!neu || neu === oldN) return full;
    return `Picture ${neu}`;
  });
  return out;
}

export function effectivePictureIndex(
  uiIndex: number,
  remap?: Map<number, number>,
): number {
  return remap?.get(uiIndex) ?? uiIndex;
}

export function stripEvalPromptMeta(prompt: string): string {
  let p = prompt.trim();
  p = p.replace(/\n\nВ данном промпте зашито:[\s\S]*?(?=\n\n[A-Za-z<]|$)/g, "");
  p = p.replace(/\n\nКирpичик:\r?\n[\s\S]*?(?=\n\n[A-Za-z<]|$)/g, "");
  p = p.replace(/\n\nКирpичик:\r?\n[\s\S]*$/g, "");
  return p.trim();
}

/** Prompt body for model — strips human eval meta; keeps scene + soundscape. */
export function promptBodyForModel(body: string, brick?: string): string {
  const stripped = stripEvalPromptMeta(body);
  if (stripped.length >= 80) return stripped;
  return (brick || stripped).trim();
}

export function slotRoleOf(slot: QuickVideoImageSlot): QuickVideoSlotRole {
  return (slot.role ||
    (slot.kind === "extra" ? "other" : slot.kind) ||
    "other") as QuickVideoSlotRole;
}

export function hasFilledLocationSlot(
  imageSlots: QuickVideoImageSlot[],
): boolean {
  return imageSlots.some((s) => slotRoleOf(s) === "location");
}

function locationPictureIndex(imageSlots: QuickVideoImageSlot[]): number {
  const hit = imageSlots.find((s) => slotRoleOf(s) === "location");
  return hit?.pictureIndex ?? LOCATION_SLOT_INDEX;
}

function anatomyUiPictureIndex(
  imageSlots: QuickVideoImageSlot[],
): number | null {
  const hit = imageSlots.find((s) => slotRoleOf(s) === "anatomy");
  return hit?.pictureIndex ?? null;
}

function locationLinesFromSlots(imageSlots: QuickVideoImageSlot[]): string[] {
  return imageSlots
    .filter((s) => slotRoleOf(s) === "location")
    .map((slot) => {
      const n = slot.pictureIndex ?? LOCATION_SLOT_INDEX;
      if (!n) return "";
      const label = slot.label?.trim();
      return `Environment, background, architecture, weather and lighting must exactly match <Picture ${n}>${label ? ` (${label})` : ""}. The scene takes place in this location — not a generic indoor room unless <Picture ${n}> shows indoors. Visible background must match this reference even in tight POV framing.`;
    })
    .filter(Boolean);
}

function primaryIdentityPictureIndex(imageSlots: QuickVideoImageSlot[]): number {
  const hit = imageSlots.find((s) => slotRoleOf(s) === "identity");
  return hit?.pictureIndex ?? imageSlots[0]?.pictureIndex ?? 1;
}

function locationSoundscapeHint(imageSlots: QuickVideoImageSlot[]): string {
  return locationLinesFromSlots(imageSlots).length
    ? "Ambient soundscape matching the location reference — outdoor/street/city or environment sounds as shown in the location picture; no generic bedroom tone."
    : "Quiet intimate room tone.";
}

function identityLockLine(imageSlots: QuickVideoImageSlot[]): string {
  const identityN = primaryIdentityPictureIndex(imageSlots);
  const locNs = imageSlots
    .filter((s) => slotRoleOf(s) === "location")
    .map((s) => s.pictureIndex)
    .filter((n): n is number => !!n);
  if (locNs.length) {
    const locTags = locNs.map((n) => `<Picture ${n}>`).join(" and ");
    return `Identity locked to <Picture ${identityN}>. Environment and background must exactly match ${locTags}.`;
  }
  return `Opens fully locked to <Picture ${identityN}>. Same people, same identity.`;
}

export function composeQuickVideoPrompt(
  userPrompt: string,
  imageSlots: QuickVideoImageSlot[],
  videoCount = 0,
  opts?: { pictureRemap?: Map<number, number>; stripEvalMeta?: boolean },
): string {
  let body = normalizeRefPrompt(userPrompt);
  if (opts?.stripEvalMeta) {
    body = stripEvalPromptMeta(body);
  }
  if (opts?.pictureRemap?.size) {
    body = remapPictureTags(body, opts.pictureRemap);
  }
  const parts: string[] = [];

  if (imageSlots.length) {
    const defs = imageSlots.map((slot, i) => {
      const n = effectivePictureIndex(slot.pictureIndex ?? i + 1, opts?.pictureRemap);
      const role = (slot.role ||
        (slot.kind === "extra" ? "other" : slot.kind) ||
        "other") as QuickVideoSlotRole;
      if (role === "identity") {
        const who =
          slot.characterName?.trim() || slot.label?.trim() || `Subject ${n}`;
        const bodyHint = slot.bodyShapeHint?.trim();
        const bodyExtra = bodyHint
          ? ` Body proportions from user settings: ${bodyHint}.`
          : "";
        return `<Picture ${n}> is ${who}'s identity reference (face, hair, skin).${bodyExtra}`;
      }
      if (role === "location") {
        const label = slot.label?.trim();
        return `<Picture ${n}> is the mandatory environment/location reference${label ? ` (${label})` : ""} — match outdoor/indoor setting, architecture, scenery, weather and lighting exactly. Do not treat this picture as identity or anatomy.`;
      }
      const hint = slot.label?.trim() || roleDefHint(role);
      return `<Picture ${n}> is the ${hint}.`;
    });
    parts.push(`subject_definitions:\n${defs.join("\n")}`);
  }

  if (videoCount > 0) {
    parts.push(
      "motion_reference:\nMatch poses, body motion, camera moves and timing from <Video 1> unless the prompt explicitly overrides.",
    );
  }

  if (!parts.length) return body;
  return `${parts.join("\n\n")}\n\n${body}`;
}

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000`;
}

function buildSubjectDefinitionsBlock(
  imageSlots: QuickVideoImageSlot[],
  remap?: Map<number, number>,
): string {
  if (!imageSlots.length) return "";
  const defs = imageSlots.map((slot, i) => {
    const n = effectivePictureIndex(slot.pictureIndex ?? i + 1, remap);
    const role = (slot.role ||
      (slot.kind === "extra" ? "other" : slot.kind) ||
      "other") as QuickVideoSlotRole;
    if (role === "identity") {
      const who =
        slot.characterName?.trim() || slot.label?.trim() || `Subject ${n}`;
      const bodyHint = slot.bodyShapeHint?.trim();
      const bodyExtra = bodyHint
        ? ` Body proportions from user settings: ${bodyHint}.`
        : "";
      return `<Picture ${n}> is ${who}'s identity reference (face, hair, skin).${bodyExtra}`;
    }
    if (role === "location") {
      const label = slot.label?.trim();
      return `<Picture ${n}> is the mandatory environment/location reference${label ? ` (${label})` : ""} — match outdoor/indoor setting, architecture, scenery, weather and lighting exactly. Do not treat this picture as identity or anatomy.`;
    }
    const hint = slot.label?.trim() || roleDefHint(role);
    return `<Picture ${n}> is the ${hint}.`;
  });
  return `subject_definitions:\n${defs.join("\n")}`;
}

function stripLegoBodyWrapper(text: string): string {
  let t = text.trim();
  const descMatch = t.match(
    /integrated_multimodal_description:\s*\[Shot\s+\d+\]\s*([\s\S]*?)(?:\n\noverall_soundscape:|\n\nnon_diegetic_music:|$)/i,
  );
  if (descMatch?.[1]) return descMatch[1].trim();
  t = t.replace(/^For the target video[^\n]*\n\n?/i, "");
  t = t.replace(/\n\noverall_soundscape:[\s\S]*$/i, "");
  t = t.replace(/\n\nnon_diegetic_music:[\s\S]*$/i, "");
  return t.trim();
}

function sanitizeBrickTextForLocation(text: string): string {
  return text
    .replace(/LOCATION-AGNOSTIC[^.]*\./gi, "")
    .replace(/,?\s*location-agnostic[^,]*/gi, "")
    .replace(/Generic indoor background\.?/gi, "")
    .replace(
      /Lighting and background stay secondary and soft[^.]*\./gi,
      "Background and lighting must match the location reference picture.",
    )
    .replace(/do not invent a (?:specific named )?place[^.]*\./gi, "")
    .replace(/A separate location tab may supply the place[^.]*\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rewritePresetAnatomyRefs(text: string, anatomyUiN: number): string {
  if (anatomyUiN === PRESET_ANATOMY_PICTURE_INDEX) return text;
  return text
    .replace(/<Picture\s+4>/gi, `<Picture ${anatomyUiN}>`)
    .replace(/\bPicture\s+4\b/gi, `Picture ${anatomyUiN}`);
}

function brickTextForCompile(
  item: LegoCatalogItem | undefined,
  kind: string,
  opts: { hasLocation: boolean; anatomyUiN: number | null },
): string {
  if (!item) return "";
  const useShortOnly = opts.hasLocation && kind !== "camera";
  let text = useShortOnly
    ? (item.text || "").trim()
    : stripLegoBodyWrapper(item.body || item.text || "");
  if (!text && item.text) text = item.text.trim();
  if (!text) return "";
  if (opts.hasLocation) text = sanitizeBrickTextForLocation(text);
  if (
    opts.anatomyUiN != null &&
    (kind === "action" || kind === "pose" || kind === "voice")
  ) {
    text = rewritePresetAnatomyRefs(text, opts.anatomyUiN);
  }
  return text.trim();
}

export function compileShotLegoSegment(
  legoQuery: string,
  ctx: QuickVideoLegoContext,
  imageSlots: QuickVideoImageSlot[] = [],
): { description: string; soundscape: string } {
  const tokens = parseLegoQuery(legoQuery.trim(), ctx.catalog);
  const analyzed = analyzeLegoTokens(tokens, ctx.characters, ctx.catalog);
  const byKey = new Map(ctx.catalog.map((c) => [`${c.kind}:${c.id}`, c]));
  const hasLocation = hasFilledLocationSlot(imageSlots);
  const locN = locationPictureIndex(imageSlots);
  const anatomyUiN = anatomyUiPictureIndex(imageSlots);
  const compileOpts = { hasLocation, anatomyUiN };

  const locationLines: string[] = [];
  const poseBodies: string[] = [];
  const actionBodies: string[] = [];
  const voiceBodies: string[] = [];
  const cameraBodies: string[] = [];
  const eventLines: string[] = [];

  for (const t of tokens) {
    if (t.type !== "tab") continue;
    const item = byKey.get(`${t.kind}:${t.id}`);
    if (t.kind === "location") {
      const refN = hasLocation ? locN : t.locationRefSlot;
      const loc =
        refN != null
          ? `Environment, background and lighting must exactly match <Picture ${refN}> — same outdoor/indoor setting as the reference photo.`
          : t.customText?.trim() || t.label.trim();
      if (loc) locationLines.push(loc);
    }
    if (t.kind === "voiceover") {
      const script = t.customText?.trim() || t.label.trim();
      if (script) voiceBodies.push(`Spoken/voiceover: ${script}`);
    }
    if (t.kind === "event") {
      const who = analyzed.receiverName || "subject";
      const custom = t.customText?.trim();
      const line = custom || item?.text || t.label;
      if (line) eventLines.push(`${who}: ${line}`);
    }
    if (t.kind === "pose") {
      const text = brickTextForCompile(item, "pose", compileOpts);
      if (text) poseBodies.push(text);
    }
    if (t.kind === "action") {
      const text = brickTextForCompile(item, "action", compileOpts);
      if (text) actionBodies.push(text);
    }
    if (t.kind === "voice") {
      const text = brickTextForCompile(item, "voice", compileOpts);
      if (text) voiceBodies.push(`Voice: ${text}`);
    }
    if (t.kind === "camera") {
      const text = brickTextForCompile(item, "camera", compileOpts);
      if (text) cameraBodies.push(`Camera: ${text}`);
    }
  }

  for (const line of locationLinesFromSlots(imageSlots)) {
    if (!locationLines.includes(line)) locationLines.push(line);
  }

  const poseItem = analyzed.poseId
    ? ctx.catalog.find((c) => c.kind === "pose" && c.id === analyzed.poseId)
    : undefined;
  const motionHint = poseItem?.videoMotion?.trim();

  const descriptionParts = [
    "Live-action, cinematic, explicit adult content.",
    analyzed.receiverName && analyzed.activeName
      ? `${analyzed.activeName} is the active partner; ${analyzed.receiverName} is receiving.`
      : analyzed.receiverName
        ? `Focus on ${analyzed.receiverName}.`
        : "",
    ...locationLines,
    ...eventLines,
    ...poseBodies,
    ...actionBodies,
    ...cameraBodies,
    motionHint ? `Motion: ${motionHint}` : "",
    ...voiceBodies,
  ].filter(Boolean);

  const description = descriptionParts.join(" ").replace(/\s+/g, " ").trim();

  const hasVoice =
    voiceBodies.length > 0 ||
    tokens.some(
      (t) => t.type === "tab" && (t.kind === "voice" || t.kind === "voiceover"),
    );

  const soundParts = [
    locationSoundscapeHint(imageSlots),
    hasVoice
      ? "Clear vocal performance as described; close mic; no music bed."
      : "Natural breathing and subtle body sounds.",
    analyzed.eventIds.length
      ? "Action-synced wet/skin sounds matching the motion."
      : "",
    "No music, no extra people.",
  ].filter(Boolean);

  return {
    description: description || legoQuery.trim(),
    soundscape: soundParts.join(" "),
  };
}

export function sumQuickVideoShotsSec(shots: QuickVideoShotInput[]): number {
  return shots.reduce((sum, s) => sum + Math.max(0, s.durationSec), 0);
}

export function serializeQuickVideoShotsPlan(plan: QuickVideoShotsPlan): string {
  return JSON.stringify({ __qvShots: 1, ...plan });
}

export function parseQuickVideoShotsPlan(
  raw: string,
): QuickVideoShotsPlan | null {
  const text = raw.trim();
  if (!text.startsWith('{"__qvShots"')) return null;
  try {
    const j = JSON.parse(text) as QuickVideoShotsPlan & { __qvShots?: number };
    if (!Array.isArray(j.shots)) return null;
    return {
      totalDurationSec: Number(j.totalDurationSec) || sumQuickVideoShotsSec(j.shots),
      shots: j.shots.map((s, i) => ({
        id: s.id || `shot-${i + 1}`,
        durationSec: Math.max(MIN_QUICK_VIDEO_SHOT_SEC, Number(s.durationSec) || 1),
        legoQuery: String(s.legoQuery || ""),
      })),
    };
  } catch {
    return null;
  }
}

export function defaultQuickVideoShots(totalDurationSec = 6): QuickVideoShotsPlan {
  return {
    totalDurationSec,
    shots: [{ id: "shot-1", durationSec: totalDurationSec, legoQuery: "" }],
  };
}

export function splitDurationEvenly(
  totalDurationSec: number,
  count: number,
): number[] {
  const n = Math.max(1, count);
  const base = Math.floor(totalDurationSec / n);
  const rem = totalDurationSec - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export function composeQuickVideoMultiShotPrompt(
  plan: QuickVideoShotsPlan,
  imageSlots: QuickVideoImageSlot[],
  videoCount = 0,
  ctx: QuickVideoLegoContext,
  opts?: { pictureRemap?: Map<number, number>; stripEvalMeta?: boolean },
): string {
  const shots = plan.shots.filter(
    (s) => s.durationSec > 0 && s.legoQuery.trim().length > 0,
  );
  const usedSec = sumQuickVideoShotsSec(shots);
  const total = Math.min(
    MAX_QUICK_VIDEO_TOTAL_SEC,
    Math.max(MIN_QUICK_VIDEO_TOTAL_SEC, plan.totalDurationSec || usedSec || 6),
  );

  if (!shots.length) {
    return composeQuickVideoPrompt("", imageSlots, videoCount, opts);
  }

  if (shots.length === 1) {
    let query = normalizeRefPrompt(shots[0]!.legoQuery);
    if (opts?.stripEvalMeta) query = stripEvalPromptMeta(query);
    if (opts?.pictureRemap?.size) query = remapPictureTags(query, opts.pictureRemap);
    const seg = compileShotLegoSegment(query, ctx, imageSlots);
    const lockLine = identityLockLine(imageSlots);
    const body = [
      `For the target video, at 0.00 seconds into the target video, <Picture ${primaryIdentityPictureIndex(imageSlots)}> (from [Shot 1]) is fully referenced.`,
      `Total target duration: about ${shots[0]!.durationSec || total} seconds.`,
      `integrated_multimodal_description: [Shot 1] ${seg.description} ${lockLine} Camera: mostly static with tiny natural sway.`,
      `overall_soundscape: ${seg.soundscape}`,
      "non_diegetic_music: N/A",
    ].join("\n\n");
    return composeQuickVideoPrompt(body, imageSlots, videoCount, opts);
  }

  const parts: string[] = [];
  const defs = buildSubjectDefinitionsBlock(imageSlots, opts?.pictureRemap);
  if (defs) parts.push(defs);
  if (videoCount > 0) {
    parts.push(
      "motion_reference:\nMatch poses, body motion, camera moves and timing from <Video 1> unless the prompt explicitly overrides.",
    );
  }

  let t = 0;
  const descLines: string[] = [];
  const soundLines: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    const start = t;
    const end = t + shot.durationSec;
    t = end;
    let query = normalizeRefPrompt(shot.legoQuery);
    if (opts?.stripEvalMeta) query = stripEvalPromptMeta(query);
    if (opts?.pictureRemap?.size) {
      query = remapPictureTags(query, opts.pictureRemap);
    }
    const seg = compileShotLegoSegment(query, ctx, imageSlots);
    const n = i + 1;
    const identityN = primaryIdentityPictureIndex(imageSlots);
    if (n === 1) {
      descLines.push(
        `[Shot 1 | 0s–${end}s] ${seg.description} ${identityLockLine(imageSlots)} Continuous scene. Camera: mostly static with tiny natural sway. Transition: continuous motion.`,
      );
    } else {
      descLines.push(
        `[Shot ${n} | At ${formatMmSs(start)}] ${seg.description} Same people, same location as location references, identity locked to <Picture ${identityN}>. No new characters. Transition: continuous motion.`,
      );
    }
    soundLines.push(`[${start}s–${end}s] ${seg.soundscape}`);
  }

  parts.push(
    `For the target video, at 0.00 seconds into the target video, <Picture ${primaryIdentityPictureIndex(imageSlots)}> (from [Shot 1]) is fully referenced.`,
  );
  parts.push(`Total target duration: about ${usedSec || total} seconds.`);
  parts.push(
    `integrated_multimodal_description:\n${descLines.join("\n")}`,
  );
  parts.push(
    `overall_soundscape:\n${soundLines.join("\n")}\nNo music, no extra people.`,
  );
  parts.push("non_diegetic_music: N/A");

  return parts.join("\n\n");
}

export function buildQuickVideoLegoContext(opts: {
  videoLego: VideoLegoFile;
  characters: LegoCharacterRef[];
  /** @deprecated photo poses — not used on video lego path */
  poses?: TemplatePose[];
}): QuickVideoLegoContext {
  return {
    catalog: buildVideoLegoCatalog({
      videoLego: opts.videoLego,
      characters: opts.characters,
    }),
    characters: opts.characters,
    poses: opts.poses,
  };
}
