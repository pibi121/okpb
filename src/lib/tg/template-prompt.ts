/**
 * Attach the viewer's character to a photo template scene (lookbook and/or LoRA).
 */
import {
  assembleLockedStillPrompt,
  characterIdentityLock,
} from "@/lib/character-identity";
import { sanitizeTemplateScenePrompt } from "@/lib/template-scene";
import {
  VIDEO_BODY_LOOKBOOK_FIELD_IDS,
  bodyShapeAppearanceForPrompt,
  parseLookbook,
} from "@/lib/lookbook";
import { prisma } from "@/lib/db";

async function bodyShapeLinesForCharacters(
  characterIds: string[],
): Promise<string[]> {
  if (!characterIds.length) return [];
  const chars = await prisma.character.findMany({
    where: { id: { in: characterIds } },
    select: { lookbookJson: true, gender: true },
  });
  const lines: string[] = [];
  for (const ch of chars) {
    const g = ch.gender === "male" ? "male" : "female";
    const hint = bodyShapeAppearanceForPrompt(
      parseLookbook(ch.lookbookJson, g),
      g,
    ).trim();
    if (hint) lines.push(hint);
  }
  return lines;
}

export async function composePhotoTemplatePromptForCharacter(opts: {
  templateEditPrompt: string;
  characterIds: string[];
  /** Dual-ref: identity comes from person image — keep scene text only. */
  sceneOnly?: boolean;
  authorNames?: string[];
  authorTriggers?: string[];
  clothed?: boolean;
}): Promise<string> {
  const scene = sanitizeTemplateScenePrompt(opts.templateEditPrompt, {
    authorNames: opts.authorNames,
    authorTriggers: opts.authorTriggers,
  });

  const bodyLines = await bodyShapeLinesForCharacters(opts.characterIds);
  const bodyLock = bodyLines.length
    ? ` BODY SHAPE LOCK (mandatory): ${bodyLines.join("; ")} — overrides conflicting body size in pictures or scene text.`
    : "";

  if (opts.sceneOnly || !opts.characterIds.length) {
    return [
      "SCENE LOCK (pose, camera, location, action, wardrobe only — do not invent hair, face, or body identity):",
      scene,
      "Identity (face, hair) must come only from the selected character / reference image. Ignore any leftover appearance traits.",
      bodyLock.trim(),
    ]
      .filter(Boolean)
      .join(" ");
  }

  const forceBody = new Set([
    ...VIDEO_BODY_LOOKBOOK_FIELD_IDS.female,
    ...VIDEO_BODY_LOOKBOOK_FIELD_IDS.male,
  ]);
  const identity = await characterIdentityLock(opts.characterIds, {
    skipIntimate: !!opts.clothed,
    forceFieldIds: forceBody,
  });
  const assembled = assembleLockedStillPrompt({
    identity,
    scene,
  });
  if (bodyLock && !/BODY SHAPE LOCK/i.test(assembled)) {
    return `${assembled}${bodyLock}`;
  }
  return assembled;
}
