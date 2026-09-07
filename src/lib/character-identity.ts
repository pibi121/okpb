/**
 * Frozen character appearance for Krea stills.
 * Lookbook + LoRA trigger must be copied verbatim — never rewritten by the LLM.
 */
import { prisma } from "@/lib/db";
import {
  BACK_VIEW_LOOKBOOK_FIELD_IDS,
  characterAppearanceForPrompt,
  isLookbookFieldInPrompt,
  isLookbookSupplementEnabled,
  parseLookbook,
  type LookbookValues,
} from "@/lib/lookbook";
import { isUserTrainedRealLora } from "@/lib/tg/studio-cast";

export type IdentityViewMode = "full" | "back";

export type IdentityLockOpts = {
  skipIntimate?: boolean;
  /** Back angles: hair + body only — no face/eyes/vibe (they flip the camera frontal). */
  viewMode?: IdentityViewMode;
  /** Always inject these lookbook fields even when LoRA would skip them. */
  forceFieldIds?: Set<string>;
};

export type IdentityCharRow = {
  id: string;
  name: string;
  gender: "male" | "female";
  trigger: string;
  lookbookEn: string;
  lookbook: LookbookValues;
  loraStatus: string;
  loraPath: string | null;
  /** False = prompts rely on LoRA trigger only (no lookbook appearance text). */
  lookbookSupplement: boolean;
};

export async function loadIdentityCharacters(
  ids: string[],
  opts?: IdentityLockOpts,
): Promise<IdentityCharRow[]> {
  if (!ids.length) return [];
  const chars = await prisma.character.findMany({ where: { id: { in: ids } } });
  const byId = new Map(chars.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((ch) => {
      const g = ch!.gender === "male" ? "male" : "female";
      const lookbook = parseLookbook(ch!.lookbookJson, g);
      const trigger =
        ch!.loraStatus === "lora_ready" && ch!.triggerWord ? ch!.triggerWord : "";
      const hasLora = !!trigger;
      // User GPU LoRA: trigger only — emptyLookbook defaults (buzz cut, etc.) must not fight weights.
      const userLoraOnly = isUserTrainedRealLora(ch!);
      const onlyFieldIds =
        opts?.viewMode === "back" ? BACK_VIEW_LOOKBOOK_FIELD_IDS[g] : undefined;
      return {
        id: ch!.id,
        name: ch!.name,
        gender: g,
        trigger,
        lookbookEn: userLoraOnly
          ? ""
          : characterAppearanceForPrompt(lookbook, g, {
              hasLora,
              skipIntimate: opts?.skipIntimate,
              onlyFieldIds,
              forceFieldIds: opts?.forceFieldIds,
            }),
        lookbook,
        loraStatus: ch!.loraStatus,
        loraPath: ch!.loraPath,
        lookbookSupplement: userLoraOnly
          ? false
          : isLookbookSupplementEnabled(lookbook, g),
      };
    });
}

/** Same identity paragraph in every still. LLM must not rewrite this. */
export async function characterIdentityLock(
  characterIds: string[],
  opts?: IdentityLockOpts,
): Promise<{
  lock: string;
  peopleCount: number;
  countLine: string;
  triggers: string;
  rows: IdentityCharRow[];
  viewMode: IdentityViewMode;
}> {
  const viewMode = opts?.viewMode || "full";
  const rows = await loadIdentityCharacters(characterIds, opts);
  const triggers = rows.map((r) => r.trigger).filter(Boolean).join(", ");
  const blocks = rows.map((ch, i) => {
    if (viewMode === "back") {
      const tag = ch.trigger ? `${ch.trigger}, ` : "";
      return `PERSON_${i + 1} is ${ch.name}, ${tag}${ch.lookbookEn}. Back view only — match hair length/color/style and body build; face is not visible.`;
    }
    if (ch.trigger && !ch.lookbookEn.trim()) {
      return `PERSON_${i + 1} is ${ch.name}, ${ch.trigger}. Keep identity from LoRA; do not invent conflicting face/hair traits.`;
    }
    const tag = ch.trigger ? `${ch.trigger}, ` : "";
    return `PERSON_${i + 1} is ${ch.name}, ${tag}${ch.lookbookEn}. Keep this exact appearance in every frame.`;
  });
  const n = rows.length || 1;
  const who =
    viewMode === "back"
      ? "Exactly one person, back to camera, face hidden, no eye contact, no frontal face."
      : n >= 2
        ? `Exactly ${n} people: ${rows.map((r) => `one ${r.gender} (${r.name})`).join(" and ")}. No extra woman, no extra man, no clone, no twins, no duplicate face.`
        : "Exactly one person in the frame, no extra people.";
  return {
    lock: blocks.join(" "),
    peopleCount: n,
    countLine: who,
    triggers,
    rows,
    viewMode,
  };
}

export function assembleLockedStillPrompt(opts: {
  identity: Awaited<ReturnType<typeof characterIdentityLock>>;
  scene: string;
  styleText?: string;
  wardrobeLine?: string;
}): string {
  const { identity, scene, styleText, wardrobeLine } = opts;
  if (!identity.rows.length) {
    return [wardrobeLine, scene.trim()].filter(Boolean).join(" ");
  }
  const lockHeader =
    identity.viewMode === "back"
      ? "BODY LOCK (back view — hair and body only, face not visible):"
      : "IDENTITY LOCK (do not change hair, face, beard, or body):";
  return [
    identity.triggers ? `${identity.triggers}.` : "",
    styleText || "",
    lockHeader,
    identity.lock,
    wardrobeLine || "",
    scene.trim() ? `SCENE (camera, location, action, wardrobe only): ${scene.trim()}` : "",
    identity.countLine,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Extra negatives when a selected male is clean-shaven (Krea invents beards on side profiles). */
export function cleanShavenNegative(rows: IdentityCharRow[]): string {
  const any = rows.some(
    (r) => r.gender === "male" && r.lookbook.facial_hair === "clean",
  );
  if (!any) return "";
  return "beard, mustache, goatee, stubble, facial hair";
}

/** Extra negatives when lookbook says shaved pubic. */
export function shavedPubicNegative(
  rows: IdentityCharRow[],
  opts?: { always?: boolean },
): string {
  const any = rows.some(
    (r) =>
      r.gender === "female" &&
      r.lookbook.genital_hair === "shaved" &&
      (opts?.always || isLookbookFieldInPrompt(r.lookbook, "genital_hair")),
  );
  if (!any) return "";
  return [
    "pubic hair",
    "hairy pubic area",
    "hairy pussy",
    "natural bush",
    "bush",
    "pubic mound hair",
    "unshaved pubic",
    "trimmed pubic hair",
    "landing strip",
  ].join(", ");
}

/** Back-view shots: block frontal face pull from LoRA / lookbook. */
export function backViewNegative(): string {
  return [
    "frontal view",
    "front facing",
    "face visible",
    "looking at camera",
    "eye contact",
    "portrait facing viewer",
    "three quarter face",
    "over the shoulder face",
  ].join(", ");
}

/** Identity pack: force shaved pubic text into positive when lookbook says shaved. */
export function shavedPubicPositive(rows: IdentityCharRow[]): string {
  const any = rows.some(
    (r) => r.gender === "female" && r.lookbook.genital_hair === "shaved",
  );
  if (!any) return "";
  return "completely shaved smooth bare pubic area, no pubic hair at all";
}
