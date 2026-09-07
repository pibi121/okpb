import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import {
  characterAppearanceForPrompt,
  parseLookbook,
} from "@/lib/lookbook";
import { isUserTrainedRealLora } from "@/lib/tg/studio-cast";
import { findPose, findStyle } from "@/lib/prompt-templates";
import { backupDatabase, resolveGalleryFile, saveGalleryBinary } from "@/lib/local-store";
import {
  comfyOutputAbsPath,
  comfyUploadImage,
  ensureComfyReady,
  runComfyAndDownload,
  runComfyJob,
  comfyI2VTimeoutMs,
  comfyStitchTimeoutMs,
} from "@/lib/comfy-client";
import { buildKreaDualRefEditGraph, buildKreaEditGraph, buildKreaT2IGraph } from "@/lib/krea-graphs";
import { resolveSkinDetail } from "@/lib/krea-skin-lora";
import {
  buildAceStepGraph,
  buildBgmMixGraph,
  buildMinimaxI2VGraph,
  buildMinimaxRef2VGraph,
  buildStitchGraph,
  clampDurationSec,
  minimaxLengthFromSec,
  minimaxSize,
  scenePlots,
} from "@/lib/video-graphs";
import { useComfy } from "@/lib/metalnode-config";
import { galleryRoot } from "@/lib/paths";
import { extractAudioWavFromVideoBuffer } from "@/lib/ffmpeg-stitch";
import { resolveCharacterIds } from "@/lib/character-ids";
import {
  composePhotoPromptLLM,
  composePhotoEditPromptLLM,
  composeVideoPromptLLM,
} from "@/lib/prompt-composer-llm";
import { ollamaUnload } from "@/lib/ollama-client";
import {
  assembleLockedStillPrompt,
  characterIdentityLock,
  cleanShavenNegative,
  shavedPubicNegative,
  loadIdentityCharacters,
} from "@/lib/character-identity";
import { wardrobeNegative, wardrobePositive } from "@/lib/wardrobe-mode";
import { locationFurnitureNegative } from "@/lib/location-mode";
import {
  ensureCumshotTrigger,
} from "@/lib/cumshot-lora";
import {
  applyAnatomyTriggers,
  resolveMinimaxLoras,
  type MinimaxLoraSpec,
} from "@/lib/anatomy-loras";
import { injectTriggers } from "@/lib/sex-loras";
import {
  productionMinimaxBase,
  productionSampling,
  withProductionFurry,
} from "@/lib/eros-production";
import {
  resolveMinimaxUnet,
  resolveMinimaxI2VUnet,
  type MinimaxBaseId,
} from "@/lib/minimax-base";

export { resolveCharacterIds };

function requireComfy() {
  if (!useComfy()) {
    throw new Error("Comfy отключён (PEACH_USE_COMFY=0)");
  }
}

/** Legacy template composer — pending preview only; generation uses LLM. */
export async function composeStillPrompt(opts: {
  characterId?: string | null;
  characterIds?: string[] | null;
  poseId?: string;
  styleId?: string;
  userNote?: string;
  includeMale?: boolean;
  /** false = skip pose/style templates, only characters + note */
  usePreset?: boolean;
}) {
  const usePreset = opts.usePreset !== false;
  const pose = usePreset && opts.poseId ? findPose(opts.poseId) : undefined;
  const style = usePreset && opts.styleId ? findStyle(opts.styleId) : undefined;
  const parts: string[] = [];

  if (style?.text) parts.push(style.text);
  if (pose?.text) parts.push(pose.text);

  const ids = resolveCharacterIds(opts);
  const chars = ids.length
    ? await prisma.character.findMany({ where: { id: { in: ids } } })
    : [];
  const byId = new Map(chars.map((c) => [c.id, c]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  ordered.forEach((ch, i) => {
    if (!ch) return;
    const gender = (ch.gender === "male" ? "male" : "female") as "male" | "female";
    const lookbook = parseLookbook(ch.lookbookJson, gender);
    const hasLora = ch.loraStatus === "lora_ready" && !!ch.triggerWord;
    const userLoraOnly = isUserTrainedRealLora(ch);
    const lb = userLoraOnly
      ? ""
      : characterAppearanceForPrompt(lookbook, gender, { hasLora });
    const who = `Person ${i + 1} (${ch.name}):`;
    if (hasLora && ch.triggerWord) {
      if (lb.trim()) {
        parts.push(`${who} ${ch.triggerWord}, ${lb}`);
      } else {
        parts.push(`${who} ${ch.triggerWord}`);
      }
    } else if (lb) {
      parts.push(`${who} ${lb}`);
    } else {
      parts.push(`${who} adult ${gender === "male" ? "man" : "woman"}`);
    }
  });

  const hasMale = ordered.some((c) => c && c.gender === "male");
  if (opts.includeMale && !hasMale) {
    parts.push("large bald muscular adult man");
  }

  if (ordered.length >= 2 || (ordered.length === 1 && opts.includeMale && !hasMale)) {
    parts.push("They are together in the same photograph");
  }

  if (opts.userNote?.trim()) parts.push(opts.userNote.trim());
  parts.push("nsfw");

  let people = ordered.length;
  if (opts.includeMale && !hasMale) people += 1;
  if (people <= 0) {
    parts.push("photorealistic scene");
  } else if (people === 1) {
    parts.push("Exactly one person in the frame, no extra people.");
  } else {
    parts.push(`Exactly ${people} people in the same frame, no extra people.`);
  }
  return parts.filter(Boolean).join(". ");
}

function isUsableCharacterLora(ch: {
  loraStatus: string;
  triggerWord: string | null;
  loraPath: string | null;
}): boolean {
  if (ch.loraStatus !== "lora_ready" || !ch.triggerWord) return false;
  const path = ch.loraPath || "";
  if (path && !path.startsWith("mock://")) return true;
  return ch.triggerWord === "olh_person";
}

async function resolveCharacterLora(characterIds: string[]): Promise<{
  use: boolean;
  loraName: string | null;
  mixedCast: boolean;
}> {
  if (!characterIds.length) return { use: false, loraName: null, mixedCast: false };
  const chars = await prisma.character.findMany({
    where: { id: { in: characterIds } },
  });
  const byId = new Map(chars.map((c) => [c.id, c]));
  const ordered = characterIds.map((id) => byId.get(id)).filter(Boolean);
  const withRealPath = ordered.find(
    (ch) =>
      ch &&
      isUsableCharacterLora(ch) &&
      ch.loraPath &&
      !ch.loraPath.startsWith("mock://"),
  );
  const ready =
    withRealPath ||
    ordered.find((ch) => ch && isUsableCharacterLora(ch));
  if (!ready) return { use: false, loraName: null, mixedCast: false };
  const loraName =
    ready.loraPath && !ready.loraPath.startsWith("mock://")
      ? ready.loraPath
      : ready.triggerWord === "olh_person"
        ? "krea2/olh_person_krea2.safetensors"
        : null;
  const mixedCast =
    ordered.length > 1 &&
    ordered.some((ch) => ch && !isUsableCharacterLora(ch));
  return { use: !!loraName, loraName, mixedCast };
}

/** @deprecated prefer resolveCharacterLora */
async function anyCharacterUsesLora(characterIds: string[]) {
  return (await resolveCharacterLora(characterIds)).use;
}

export function localBytesFromResultUrl(resultUrl: string): Buffer | null {
  if (resultUrl.startsWith("/api/media/")) {
    const key = resultUrl.replace(/^\/api\/media\//, "");
    const abs = resolveGalleryFile(key);
    if (abs) return fs.readFileSync(abs);
  }
  if (resultUrl.startsWith("/")) {
    const staticPath = path.join(process.cwd(), "public", resultUrl.replace(/^\//, ""));
    if (fs.existsSync(staticPath)) return fs.readFileSync(staticPath);
  }
  if (resultUrl.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(resultUrl);
    if (m) return Buffer.from(m[2], "base64");
  }
  return null;
}

async function saveStillItem(opts: {
  userId: string;
  characterId?: string | null;
  title: string;
  prompt: string;
  width: number;
  height: number;
  bytes: Buffer;
  prefix?: string;
  meta?: Record<string, unknown>;
}) {
  const saved = saveGalleryBinary(
    opts.userId,
    "png",
    opts.bytes,
    opts.prefix || "still",
  );
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: opts.characterId || null,
      kind: "photo",
      title: opts.title,
      prompt: opts.prompt,
      resultUrl: saved.publicUrl,
      width: opts.width,
      height: opts.height,
      metaJson: JSON.stringify({
        status: "ready",
        localKey: saved.relKey,
        ...opts.meta,
      }),
    },
  });
  backupDatabase("gallery-still");
  return item;
}

export async function generatePhotoBytes(opts: {
  userId: string;
  characterId?: string | null;
  characterIds?: string[] | null;
  title?: string;
  poseId?: string;
  styleId?: string;
  userNote?: string;
  includeMale?: boolean;
  usePreset?: boolean;
  presetId?: string | null;
  width?: number;
  height?: number;
  editOfId?: string;
  editPrompt?: string;
  /** Skip LLM if already composed */
  composedPrompt?: string;
  /** Fixed seed for tester variations */
  seed?: number;
  /** Override LoRA wiring (tester: lookbook vs lora) */
  useCharacterLora?: boolean;
  /** Override Krea negative prompt */
  negativePrompt?: string;
  /** Appended to extraNegative (identity pack, etc.) */
  extraNegativeAppend?: string;
  /** Skin texture LoRA on Krea T2I (default on @ 1.2) */
  skinDetail?: boolean;
  skinDetailStrength?: number;
  /** Keep garments from the user note; suppress nudity */
  clothed?: boolean;
  /** Nipples poking through clothes — only with clothed */
  pokies?: boolean;
  /** Frame-level "never" constraints — forwarded to LLM as a separate CONSTRAINTS block */
  never?: string;
  /** LEGO tab query — deterministic compile, skips LLM */
  legoQuery?: string;
  /** Krea dual-ref: person identity photo */
  dualRefPersonBuffer?: Buffer;
  /** Template preview locks pose; else T2I plate from scene-only prompt */
  dualRefSceneBuffer?: Buffer;
  useIdentityDualRef?: boolean;
  photoTemplateId?: string;
  /** TG PhotoTemplate — scene preview + face ref, scene-grounded dual-ref */
  tgPhotoTemplateId?: string;
}) {
  const width = opts.width ?? 888;
  const height = opts.height ?? 1176;
  let characterIds = resolveCharacterIds(opts);
  const seed =
    typeof opts.seed === "number" && Number.isFinite(opts.seed)
      ? Math.floor(opts.seed)
      : Math.floor(Math.random() * 1e15);
  const clothed = !!opts.clothed;
  const pokies = clothed && !!opts.pokies;
  let prompt: string;
  let legoSkin: { skinDetail?: boolean; skinDetailStrength?: number } = {};
  let conceptLoras: Array<{
    name: string;
    strength: number;
    strengthClip: number;
  }> = [];
  let conceptMatched: string[] = [];

  if (opts.tgPhotoTemplateId) {
    const tpl = await import("@/lib/tg-photo-template-lab").then((m) =>
      m.getTgPhotoTemplateForGeneration(opts.tgPhotoTemplateId!),
    );
    const { composePhotoTemplatePromptForCharacter } = await import(
      "@/lib/tg/template-prompt"
    );
    const raw =
      opts.composedPrompt?.trim() ||
      tpl?.editPrompt?.trim() ||
      tpl?.title ||
      "photorealistic adult scene";
    // If caller already composed with the selected character, keep it.
    // Otherwise rebuild: scene-only for dual-ref, full lock for LoRA/T2I.
    if (
      opts.composedPrompt?.trim() &&
      (/IDENTITY LOCK/i.test(opts.composedPrompt) ||
        /SCENE LOCK/i.test(opts.composedPrompt))
    ) {
      prompt = opts.composedPrompt.trim();
    } else {
      prompt = await composePhotoTemplatePromptForCharacter({
        templateEditPrompt: raw,
        characterIds,
        sceneOnly: !!opts.useIdentityDualRef,
        clothed,
      });
    }
  } else if (opts.legoQuery?.trim()) {
    const {
      compileLegoToKreaPrompt,
      compileLegoSceneOnlyPrompt,
    } = await import("@/lib/prompt-lego");
    const {
      injectKreaConceptTriggers,
      resolveKreaConceptLoras,
    } = await import("@/lib/krea-concept-loras");
    const allChars = await prisma.character.findMany({
      where: { userId: opts.userId },
    });
    const refs = allChars.map((c) => ({
      id: c.id,
      name: c.name,
      gender: c.gender,
      triggerWord: c.triggerWord,
    }));
    const compiled = opts.useIdentityDualRef || opts.photoTemplateId
      ? await compileLegoSceneOnlyPrompt({
          query: opts.legoQuery.trim(),
          characters: refs,
        })
      : await compileLegoToKreaPrompt({
          query: opts.legoQuery.trim(),
          characters: refs,
          characterIds,
        });
    prompt = compiled.prompt;
    if (
      !opts.useIdentityDualRef &&
      !opts.photoTemplateId &&
      compiled.meta.characterIdsInOrder.length
    ) {
      characterIds = compiled.meta.characterIdsInOrder;
    }
    if (compiled.meta.poseId) opts.poseId = compiled.meta.poseId;
    if (compiled.meta.styleId) opts.styleId = compiled.meta.styleId;
    legoSkin = {
      skinDetail: compiled.meta.skinDetail,
      skinDetailStrength: compiled.meta.skinDetailStrength,
    };
    const concept = resolveKreaConceptLoras({
      poseId: compiled.meta.poseId,
      tabIds: compiled.meta.tabIds,
      query: opts.legoQuery,
      scene: compiled.meta.scene,
    });
    conceptLoras = concept.loras.map((l) => ({
      name: l.name,
      strength: l.strength,
      strengthClip: l.strengthClip,
    }));
    conceptMatched = concept.matchedIds;
    prompt = injectKreaConceptTriggers(
      prompt,
      concept.triggers,
      concept.promptBoosts,
    );
  } else if (opts.composedPrompt?.trim()) {
    const raw = opts.composedPrompt.trim();
    if (/IDENTITY LOCK/i.test(raw) || /SCENE LOCK/i.test(raw)) {
      // Already assembled for a specific character / dual-ref scene — keep.
      prompt = raw;
    } else if (characterIds.length) {
      const identity = await characterIdentityLock(characterIds, {
        skipIntimate: clothed,
      });
      prompt = assembleLockedStillPrompt({
        identity,
        scene: raw,
        wardrobeLine: wardrobePositive(clothed, pokies),
      });
    } else if (clothed && !/WARDROBE LOCK/i.test(raw)) {
      prompt = `${wardrobePositive(clothed, pokies)} ${raw}`.trim();
    } else {
      prompt = raw;
    }
  } else if (opts.editPrompt?.trim() && opts.editOfId) {
    const src = await prisma.galleryItem.findFirst({
      where: { id: opts.editOfId, userId: opts.userId },
    });
    if (!src) throw new Error("source still missing");
    prompt = await composePhotoEditPromptLLM({
      originalPrompt: src.prompt || "",
      editWishes: opts.editPrompt.trim(),
    });
  } else {
    prompt = await composePhotoPromptLLM({ ...opts, characterIds });
  }

  if (!opts.legoQuery?.trim()) {
    const {
      injectKreaConceptTriggers,
      resolveKreaConceptLoras,
    } = await import("@/lib/krea-concept-loras");
    const concept = resolveKreaConceptLoras({
      poseId: opts.poseId,
      tabIds: opts.styleId ? [opts.styleId] : [],
      query: opts.userNote,
      scene: prompt,
    });
    conceptLoras = concept.loras.map((l) => ({
      name: l.name,
      strength: l.strength,
      strengthClip: l.strengthClip,
    }));
    conceptMatched = concept.matchedIds;
    prompt = injectKreaConceptTriggers(
      prompt,
      concept.triggers,
      concept.promptBoosts,
    );
  }

  const characterId = characterIds[0] || opts.characterId || null;

  if (!opts.legoQuery?.trim()) {
    await ollamaUnload();
  }
  requireComfy();
  await ensureComfyReady(40, 2000);

  const skin = resolveSkinDetail({
    skinDetail:
      typeof opts.skinDetail === "boolean"
        ? opts.skinDetail
        : legoSkin.skinDetail,
    skinDetailStrength:
      typeof opts.skinDetailStrength === "number"
        ? opts.skinDetailStrength
        : legoSkin.skinDetailStrength,
  });

  let bytes: Buffer;
  let engine: string;

  const dualPerson = opts.dualRefPersonBuffer;

  if (
    (opts.useIdentityDualRef ||
      opts.photoTemplateId ||
      opts.tgPhotoTemplateId) &&
    dualPerson?.length &&
    !opts.editOfId
  ) {
    let dualScene = opts.dualRefSceneBuffer;
    if (!dualScene?.length && opts.tgPhotoTemplateId) {
      const { resolveTgPhotoTemplateSceneBuffer } = await import(
        "@/lib/tg-photo-template-lab"
      );
      dualScene =
        (await resolveTgPhotoTemplateSceneBuffer(opts.tgPhotoTemplateId)) ||
        undefined;
    }
    if (!dualScene?.length && opts.photoTemplateId) {
      const { resolvePhotoTemplateSceneBuffer } = await import("@/lib/photo-refs");
      dualScene =
        (await resolvePhotoTemplateSceneBuffer(
          opts.userId,
          opts.photoTemplateId,
        )) || undefined;
    }
    if (!dualScene?.length) {
      const idRows = await loadIdentityCharacters(characterIds);
      const sceneGraph = buildKreaT2IGraph({
        prompt,
        width,
        height,
        seed,
        useCharacterLora: false,
        useNsfwLora: clothed ? false : true,
        skinDetail: skin.enabled,
        skinDetailStrength: skin.enabled ? skin.strength : undefined,
        extraLoras: conceptLoras,
        negativePrompt: opts.negativePrompt || wardrobeNegative(clothed, pokies),
        extraNegative: [
          cleanShavenNegative(idRows),
          shavedPubicNegative(idRows),
          opts.extraNegativeAppend,
          locationFurnitureNegative(opts.userNote),
        ]
          .filter(Boolean)
          .join(", "),
        filenamePrefix: "peach/dual_scene_plate",
      });
      dualScene = await runComfyAndDownload(sceneGraph, "peach-scene-plate");
    }
    const sceneUp = await comfyUploadImage(
      `peach_dual_scene_${Date.now()}.png`,
      dualScene,
    );
    const personUp = await comfyUploadImage(
      `peach_dual_person_${Date.now()}.png`,
      dualPerson,
    );
    const isTgFace = !!opts.tgPhotoTemplateId;
    const graph = buildKreaDualRefEditGraph({
      sceneImageName: sceneUp,
      personImageName: personUp,
      editPrompt: prompt,
      width,
      height,
      seed,
      grounding: isTgFace ? "scene_pose" : "person_identity",
      refBoost: isTgFace ? 5.0 : opts.photoTemplateId ? 5.0 : 4.0,
      refBoostA: isTgFace ? 1.2 : opts.photoTemplateId ? 0.85 : 1.0,
      refBoostB: isTgFace ? 1.45 : opts.photoTemplateId ? 1.35 : 1.0,
      useNsfwLora: !clothed,
      extraLoras: conceptLoras,
    });
    bytes = await runComfyAndDownload(graph, "peach-dual-edit");
    const conceptTag = conceptMatched.length
      ? `+concept(${conceptMatched.join(",")})`
      : "";
    engine = isTgFace
      ? `krea2_tg_face_template+nsfw${conceptTag}`
      : opts.photoTemplateId
        ? `krea2_dual_edit+template_pose${conceptTag}`
        : `krea2_dual_edit+prompt_scene${conceptTag}`;
  } else if (opts.editPrompt?.trim() && opts.editOfId) {
    const src = await prisma.galleryItem.findFirst({
      where: { id: opts.editOfId, userId: opts.userId },
    });
    if (!src) throw new Error("source still missing");
    const srcBytes = localBytesFromResultUrl(src.resultUrl);
    if (!srcBytes) throw new Error("source file not local — regenerate still first");
    const uploaded = await comfyUploadImage(
      `peach_edit_${Date.now()}.png`,
      srcBytes,
    );
    const graph = buildKreaEditGraph({
      imageName: uploaded,
      editPrompt: prompt,
      width: src.width || width,
      height: src.height || height,
    });
    bytes = await runComfyAndDownload(graph, "peach-edit");
    engine = "krea2_edit";
  } else {
    const lora = await resolveCharacterLora(characterIds);
    const useChar =
      typeof opts.useCharacterLora === "boolean"
        ? opts.useCharacterLora
        : lora.use;
    const idRows = await loadIdentityCharacters(characterIds);
    const graph = buildKreaT2IGraph({
      prompt,
      width,
      height,
      seed,
      useCharacterLora: useChar,
      characterLoraName: lora.loraName || undefined,
      characterLoraStrength: lora.mixedCast ? 0.7 : 1.0,
      useNsfwLora: clothed ? false : true,
      skinDetail: skin.enabled,
      skinDetailStrength: skin.enabled ? skin.strength : undefined,
      extraLoras: conceptLoras,
      negativePrompt: opts.negativePrompt || wardrobeNegative(clothed, pokies),
      extraNegative: [
        cleanShavenNegative(idRows),
        shavedPubicNegative(idRows),
        opts.extraNegativeAppend,
        locationFurnitureNegative(opts.userNote),
      ]
        .filter(Boolean)
        .join(", "),
    });
    bytes = await runComfyAndDownload(graph, "peach-t2i");
    const conceptTag = conceptMatched.length
      ? `+concept(${conceptMatched.join(",")})`
      : "";
    engine = useChar
      ? clothed
        ? skin.enabled
          ? `krea2_char+skin${conceptTag}`
          : `krea2_char${conceptTag}`
        : skin.enabled
          ? `krea2_char_nsfw+skin${conceptTag}`
          : `krea2_char_nsfw${conceptTag}`
      : clothed
        ? skin.enabled
          ? `krea2_clothed+skin${conceptTag}`
          : `krea2_clothed${conceptTag}`
        : skin.enabled
          ? `krea2_nsfw+skin${conceptTag}`
          : `krea2_nsfw${conceptTag}`;
  }

  if (!bytes?.length || bytes.length < 100) {
    throw new Error("Comfy вернул пустой файл — повтори генерацию");
  }

  const sourceUrl = opts.editOfId
    ? (await prisma.galleryItem.findUnique({ where: { id: opts.editOfId } }))?.resultUrl
    : null;

  return {
    bytes,
    prompt,
    seed,
    title: opts.title || (opts.editPrompt ? "Edited still" : "Peach still"),
    characterId,
    sourceUrl: sourceUrl || null,
    width,
    height,
    prefix: opts.editPrompt ? "edit" : "still",
    engine,
    meta: {
      poseId: opts.poseId,
      styleId: opts.styleId,
      characterIds,
      usePreset: opts.usePreset !== false,
      presetId: opts.presetId || null,
      userNote: opts.userNote || "",
      includeMale: !!opts.includeMale,
      clothed,
      pokies,
      editOfId: opts.editOfId,
      seed,
      skinDetail: skin.enabled,
      skinDetailStrength: skin.enabled ? skin.strength : undefined,
      conceptLoras: conceptMatched,
      photoTemplateId: opts.photoTemplateId || null,
      tgPhotoTemplateId: opts.tgPhotoTemplateId || null,
      galleryDir: galleryRoot(),
    },
  };
}

/** Sync save — used by scripts / film internals. */
export async function createPhoto(opts: Parameters<typeof generatePhotoBytes>[0]) {
  const out = await generatePhotoBytes(opts);
  const saved = saveGalleryBinary(opts.userId, "png", out.bytes, out.prefix);
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: out.characterId,
      kind: "photo",
      title: out.title,
      prompt: out.prompt,
      editPrompt: opts.editPrompt || null,
      sourceUrl: out.sourceUrl,
      resultUrl: saved.publicUrl,
      width: out.width,
      height: out.height,
      metaJson: JSON.stringify({
        status: "ready",
        ...out.meta,
        localKey: saved.relKey,
        engine: out.engine,
      }),
    },
  });
  backupDatabase("gallery");
  return item;
}

/** @deprecated use createPhoto */
export const createMockPhoto = createPhoto;

export async function generateClipBytes(opts: {
  userId: string;
  characterId?: string | null;
  title?: string;
  plot: string;
  stillId?: string;
  withMusic?: boolean;
  durationSec?: number;
  /** Skip LLM if the user already previewed/edited the MiniMax prompt */
  composedPrompt?: string;
  /** Override pose from still meta (template frame poseId) */
  poseId?: string;
  /** Spoken lines for this clip */
  dialogue?: string;
}) {
  const durationSec = clampDurationSec(opts.durationSec);
  let still = opts.stillId
    ? await prisma.galleryItem.findFirst({
        where: { id: opts.stillId, userId: opts.userId },
      })
    : null;

  let videoPrompt = opts.composedPrompt?.trim() || "";
  let poseId: string | undefined;

  if (still) {
    try {
      const meta = JSON.parse(still.metaJson || "{}") as { poseId?: string };
      poseId = meta.poseId || undefined;
    } catch {
      /* ignore */
    }
  }
  if (opts.poseId?.trim()) poseId = opts.poseId.trim();

  if (!still) {
    poseId = "cowgirl";
    const photoPrompt = await composePhotoPromptLLM({
      characterId: opts.characterId,
      userNote: opts.plot,
      poseId: "cowgirl",
      styleId: "warm_lamp_bedroom",
    });
    if (!videoPrompt) {
      videoPrompt = await composeVideoPromptLLM({
        stillPrompt: photoPrompt,
        userNote: opts.plot,
        stillTitle: "Still for clip",
        poseId,
        durationSec,
        dialogue: opts.dialogue,
      });
    }
    const generated = await generatePhotoBytes({
      userId: opts.userId,
      characterId: opts.characterId,
      title: "Still for clip",
      userNote: opts.plot,
      poseId: "cowgirl",
      styleId: "warm_lamp_bedroom",
      composedPrompt: photoPrompt,
    });
    still = await saveStillItem({
      userId: opts.userId,
      characterId: opts.characterId,
      title: generated.title,
      prompt: generated.prompt,
      width: generated.width,
      height: generated.height,
      bytes: generated.bytes,
      meta: generated.meta,
    });
  } else if (!videoPrompt) {
    videoPrompt = await composeVideoPromptLLM({
      stillPrompt: still.prompt || "",
      userNote: opts.plot,
      stillTitle: still.title,
      poseId,
      durationSec,
      dialogue: opts.dialogue,
    });
  }

  const spoken = opts.dialogue?.trim();
  if (spoken && videoPrompt && !/spoken dialogue/i.test(videoPrompt)) {
    videoPrompt = `${videoPrompt} Spoken dialogue (perform clearly): ${spoken}`;
  }

  await ollamaUnload();
  requireComfy();
  await ensureComfyReady(40, 2000);

  const width = still.width || 888;
  const height = still.height || 1176;
  const stillBytes = localBytesFromResultUrl(still.resultUrl);
  if (!stillBytes) {
    throw new Error("still file not local — перегенерируй фото");
  }

  const out = await runI2VFromStill({
    stillBytes,
    prompt: videoPrompt,
    width,
    height,
    filenamePrefix: "peach/clip",
    withMusic: !!opts.withMusic,
    durationSec,
    extraHints: [opts.plot, opts.dialogue, still?.prompt, still?.title],
  });

  if (!out.bytes?.length || out.bytes.length < 100) {
    throw new Error("Видео не удалось создать — попробуй ещё раз");
  }

  return {
    bytes: out.bytes,
    prompt: out.prompt,
    title: opts.title || "1 clip",
    sourceUrl: still.resultUrl,
    width,
    height,
    engine: out.engine,
    meta: {
      stillId: still.id,
      withMusic: !!opts.withMusic,
      durationSec,
      poseId: poseId || null,
      userWishes: opts.plot,
      composedByUser: !!opts.composedPrompt?.trim(),
      serverVideo: out.videoPath,
      serverBgm: out.audioPath,
      size: out.size,
      galleryDir: galleryRoot(),
      cumshotLora: out.useCumshotLora,
    },
  };
}

export async function createClip(opts: Parameters<typeof generateClipBytes>[0]) {
  const out = await generateClipBytes(opts);
  const saved = saveGalleryBinary(opts.userId, "mp4", out.bytes, "clip");
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: opts.characterId || null,
      kind: "video",
      title: out.title,
      prompt: out.prompt,
      sourceUrl: out.sourceUrl,
      resultUrl: saved.publicUrl,
      width: out.width,
      height: out.height,
      metaJson: JSON.stringify({
        status: "ready",
        ...out.meta,
        localKey: saved.relKey,
        engine: out.engine,
      }),
    },
  });
  backupDatabase("clip");
  return item;
}

async function maybeMixBgm(opts: {
  videoPath: string;
  seconds: number;
  filenamePrefix: string;
}): Promise<{ bytes: Buffer; videoPath: string; audioPath: string; engine: string }> {
  const bgm = await runComfyJob(
    buildAceStepGraph({ seconds: opts.seconds, filenamePrefix: "audio/peach_bgm" }),
    "peach-bgm",
    240_000,
  );
  const audioPath = comfyOutputAbsPath(bgm.ref);
  const mixed = await runComfyJob(
    buildBgmMixGraph({
      videoPath: opts.videoPath,
      audioPath,
      filenamePrefix: opts.filenamePrefix,
    }),
    "peach-mix",
    240_000,
  );
  return {
    bytes: mixed.bytes,
    videoPath: comfyOutputAbsPath(mixed.ref),
    audioPath,
    engine: "minimax_h3+ace+dj",
  };
}

export async function runI2VFromStill(opts: {
  stillBytes: Buffer;
  /** Full MiniMax prompt from LLM composer */
  prompt: string;
  width: number;
  height: number;
  filenamePrefix: string;
  withMusic?: boolean;
  durationSec?: number;
  /** Extra text (plot, still prompt, notes) to detect male cumshot LoRA */
  extraHints?: Array<string | null | undefined>;
  /** If set, skip auto anatomy LoRAs and use this pack instead (empty = none). */
  lorasOverride?: MinimaxLoraSpec[] | null;
  extraTriggers?: string[];
  engineSuffixOverride?: string;
  /** stock → FL2VA; eros_max → Eros BF16 (production default via eros-production). */
  minimaxBase?: MinimaxBaseId | string | null;
  unetName?: string | null;
  steps?: number;
  samplerName?: string;
  schedulerName?: string;
}) {
  const durationSec = clampDurationSec(opts.durationSec);
  const length = minimaxLengthFromSec(durationSec);
  const size = minimaxSize(opts.width, opts.height);
  const useOverride = opts.lorasOverride !== undefined && opts.lorasOverride !== null;
  const { finalizePromptSpeechForModel } = await import("@/lib/speech-slots");
  const promptIn = finalizePromptSpeechForModel(opts.prompt.trim());
  const anatomy = useOverride
    ? {
        loras: [] as MinimaxLoraSpec[],
        usePenis: false,
        usePussy: false,
        useCumshot: false,
        engineSuffix: "",
      }
    : resolveMinimaxLoras(promptIn, ...(opts.extraHints || []));
  let prompt = useOverride
    ? promptIn
    : applyAnatomyTriggers(promptIn, anatomy);
  if (anatomy.useCumshot) prompt = ensureCumshotTrigger(prompt);
  if (opts.extraTriggers?.length) {
    prompt = injectTriggers(prompt, opts.extraTriggers);
  }
  const base = resolveMinimaxI2VUnet(productionMinimaxBase(opts.minimaxBase));
  const unetName = opts.unetName?.trim() || base.unetName;
  const uploaded = await comfyUploadImage(
    `peach_i2v_${Date.now()}.png`,
    opts.stillBytes,
  );
  let loras = useOverride ? [...(opts.lorasOverride || [])] : anatomy.loras;
  let furrySuffix = "";
  if (!useOverride) {
    const fused = withProductionFurry(loras, "i2v");
    loras = fused.loras;
    furrySuffix = fused.engineSuffix;
  }
  let engine = `minimax_h3_i2v${base.engineTag}${
    opts.engineSuffixOverride ?? `${anatomy.engineSuffix}${furrySuffix}`
  }`;
  const sampling = productionSampling("i2v");
  const graphCommon = {
    imageName: uploaded,
    prompt,
    width: size.width,
    height: size.height,
    length,
    filenamePrefix: opts.filenamePrefix,
    unetName,
    steps: opts.steps ?? sampling.steps,
    samplerName: opts.samplerName ?? sampling.samplerName,
    schedulerName: opts.schedulerName ?? sampling.schedulerName,
  };
  let clip;
  try {
    clip = await runComfyJob(
      buildMinimaxI2VGraph({ ...graphCommon, loras }),
      "peach-i2v",
      comfyI2VTimeoutMs(durationSec),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hasAnatomy = !useOverride && loras.some((l) => !/cumshot/i.test(l.name));
    if (hasAnatomy && /lora|not found|does not exist|No such file/i.test(msg)) {
      console.warn("[peach] anatomy LoRA missing, retry without:", msg.slice(0, 240));
      loras = loras.filter((l) => /cumshot/i.test(l.name));
      clip = await runComfyJob(
        buildMinimaxI2VGraph({ ...graphCommon, loras }),
        "peach-i2v",
        comfyI2VTimeoutMs(durationSec),
      );
      engine = `minimax_h3_i2v${base.engineTag}${loras.length ? "+cumshot" : ""}+anatomy_skip`;
    } else {
      throw e;
    }
  }
  let bytes = clip.bytes;
  let videoPath = comfyOutputAbsPath(clip.ref);
  let audioPath: string | null = null;
  if (opts.withMusic) {
    try {
      const mixed = await maybeMixBgm({
        videoPath,
        seconds: Math.max(12, durationSec + 2),
        filenamePrefix: `${opts.filenamePrefix}_bgm`,
      });
      bytes = mixed.bytes;
      videoPath = mixed.videoPath;
      audioPath = mixed.audioPath;
      engine = mixed.engine;
    } catch (e) {
      console.error("[peach] BGM mix failed, keeping MiniMax audio:", e);
      engine = `${engine}+bgm_fail`;
    }
  }
  return {
    bytes,
    videoPath,
    audioPath,
    engine,
    size,
    durationSec,
    length,
    prompt,
    useCumshotLora: anatomy.useCumshot,
    unetName,
    baseId: base.baseId,
  };
}

/**
 * Ref2V clip — generates video directly from reference photos, no Krea still needed.
 * refImageBuffers: character portrait photos (up to 9).
 * refVideoBuffer: optional pose/motion driving clip.
 * contextFrameBuffer: optional last-frame PNG from previous clip for motion continuity.
 */
export async function runRef2VClip(opts: {
  refImageBuffers: Buffer[];
  refVideoBuffer?: Buffer | null;
  refVideoName?: string;
  contextFrameBuffer?: Buffer | null;
  prompt: string;
  width: number;
  height: number;
  filenamePrefix: string;
  durationSec?: number;
  withMusic?: boolean;
  extraHints?: Array<string | null | undefined>;
  /** If set, skip auto anatomy LoRAs and use this pack instead (empty = none). */
  lorasOverride?: MinimaxLoraSpec[] | null;
  /** Extra trigger tokens injected after [Shot 1] (e.g. hmmotion). */
  extraTriggers?: string[];
  /** Suffix appended to engine id when using lorasOverride. */
  engineSuffixOverride?: string;
  /** MiniMax diffusion base (production default: Eros Max BF16 via eros-production). */
  minimaxBase?: MinimaxBaseId | string | null;
  /** Direct UNET filename override (wins over minimaxBase). */
  unetName?: string | null;
  /** Override sampler steps (production Ref2V default: 7 / er_sde). */
  steps?: number;
  samplerName?: string;
  schedulerName?: string;
}) {
  requireComfy();
  await ollamaUnload();
  await ensureComfyReady(30, 1500);

  const durationSec = clampDurationSec(opts.durationSec);
  const length = minimaxLengthFromSec(durationSec);
  const size = minimaxSize(opts.width, opts.height);
  const useOverride = opts.lorasOverride !== undefined && opts.lorasOverride !== null;
  const { finalizePromptSpeechForModel } = await import("@/lib/speech-slots");
  const promptIn = finalizePromptSpeechForModel(opts.prompt.trim());
  const anatomy = useOverride
    ? {
        loras: [] as MinimaxLoraSpec[],
        usePenis: false,
        usePussy: false,
        useCumshot: false,
        engineSuffix: "",
      }
    : resolveMinimaxLoras(promptIn, ...(opts.extraHints || []));
  let prompt = useOverride
    ? promptIn
    : applyAnatomyTriggers(promptIn, anatomy);
  if (anatomy.useCumshot) prompt = ensureCumshotTrigger(prompt);
  if (opts.extraTriggers?.length) {
    prompt = injectTriggers(prompt, opts.extraTriggers);
  }

  const ts = Date.now();
  const refImageNames: string[] = [];
  for (let i = 0; i < opts.refImageBuffers.length; i++) {
    const name = await comfyUploadImage(
      `peach_ref2v_char_${ts}_${i}.png`,
      opts.refImageBuffers[i],
    );
    refImageNames.push(name);
  }

  let contextImageName: string | undefined;
  if (opts.contextFrameBuffer?.length) {
    contextImageName = await comfyUploadImage(
      `peach_ref2v_ctx_${ts}.png`,
      opts.contextFrameBuffer,
    );
  }

  let refVideoNames: string[] | undefined;
  let refVideoAudioNames: string[] | undefined;
  if (opts.refVideoBuffer?.length) {
    const driveHint = opts.refVideoName || "pose.mp4";
    const ext = /\.[a-z0-9]+$/i.test(driveHint)
      ? driveHint.match(/\.[a-z0-9]+$/i)![0].toLowerCase()
      : ".mp4";
    const mime =
      ext === ".webm"
        ? "video/webm"
        : ext === ".mov"
          ? "video/quicktime"
          : "video/mp4";
    const driveUploaded = await comfyUploadImage(
      `peach_ref2v_pose_${ts}${ext}`,
      opts.refVideoBuffer,
      mime,
    );
    refVideoNames = [driveUploaded];
    const wav = await extractAudioWavFromVideoBuffer(opts.refVideoBuffer, {
      maxSec: durationSec,
      ext,
    });
    if (wav?.length) {
      const audName = await comfyUploadImage(
        `peach_ref2v_pose_${ts}.wav`,
        wav,
        "audio/wav",
      );
      refVideoAudioNames = [audName];
    }
  }

  let loras = useOverride ? [...(opts.lorasOverride || [])] : anatomy.loras;
  let furrySuffix = "";
  if (!useOverride) {
    const fused = withProductionFurry(loras, "ref2v");
    loras = fused.loras;
    furrySuffix = fused.engineSuffix;
  }
  const base = resolveMinimaxUnet(productionMinimaxBase(opts.minimaxBase));
  const unetName = opts.unetName?.trim() || base.unetName;
  const baseTag =
    opts.unetName?.trim() && opts.unetName.trim() !== base.unetName
      ? `+unet(${opts.unetName.trim()})`
      : base.engineTag;
  const suffix = `${
    useOverride
      ? opts.engineSuffixOverride || ""
      : `${anatomy.engineSuffix}${furrySuffix}`
  }${baseTag}`;
  let engine = refVideoNames?.length
    ? `minimax_h3_ref2v+ref_video${suffix}`
    : `minimax_h3_ref2v${suffix}`;

  const sampling = productionSampling("ref2v");
  const graphOpts = {
    refImageNames,
    refVideoNames,
    refVideoAudioNames,
    contextImageName,
    prompt,
    width: size.width,
    height: size.height,
    length,
    refVideoFrameCap: length,
    filenamePrefix: opts.filenamePrefix,
    loras,
    unetName,
    steps: opts.steps ?? sampling.steps,
    samplerName: opts.samplerName ?? sampling.samplerName,
    schedulerName: opts.schedulerName ?? sampling.schedulerName,
  };

  let clip;
  try {
    clip = await runComfyJob(
      buildMinimaxRef2VGraph(graphOpts),
      "peach-ref2v",
      comfyI2VTimeoutMs(durationSec),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hasAnatomy = loras.some((l) => !/cumshot/i.test(l.name));
    if (hasAnatomy && /lora|not found|does not exist|No such file/i.test(msg)) {
      console.warn("[peach] anatomy LoRA missing for ref2v, retry without:", msg.slice(0, 240));
      loras = loras.filter((l) => /cumshot/i.test(l.name));
      clip = await runComfyJob(
        buildMinimaxRef2VGraph({ ...graphOpts, loras }),
        "peach-ref2v",
        comfyI2VTimeoutMs(durationSec),
      );
      engine = refVideoNames?.length
        ? "minimax_h3_ref2v+ref_video+anatomy_skip"
        : "minimax_h3_ref2v+anatomy_skip";
    } else {
      throw e;
    }
  }

  let bytes = clip.bytes;
  let videoPath = comfyOutputAbsPath(clip.ref);
  let audioPath: string | null = null;
  if (opts.withMusic) {
    try {
      const mixed = await maybeMixBgm({
        videoPath,
        seconds: Math.max(12, durationSec + 2),
        filenamePrefix: `${opts.filenamePrefix}_bgm`,
      });
      bytes = mixed.bytes;
      videoPath = mixed.videoPath;
      audioPath = mixed.audioPath;
      engine = mixed.engine;
    } catch (e) {
      console.error("[peach] BGM mix failed for ref2v:", e);
      engine = `${engine}+bgm_fail`;
    }
  }

  return { bytes, videoPath, audioPath, engine, size, durationSec, length, prompt };
}

export async function generateFilmBytes(opts: {
  userId: string;
  characterId?: string | null;
  title?: string;
  plot: string;
  sceneCount?: number;
  withMusic?: boolean;
  durationSec?: number;
}) {
  const n = Math.min(Math.max(opts.sceneCount ?? 2, 2), 4);
  const durationSec = clampDurationSec(opts.durationSec);
  const length = minimaxLengthFromSec(durationSec);
  const plots = scenePlots(opts.plot, n);
  const jobId = `f${Date.now().toString(36)}`;
  const stitchDir = `/work/ComfyUI/output/peach/stitch/${jobId}`;
  const sceneStillIds: string[] = [];
  let width = 768;
  let height = 1344;

  const planned: { photoPrompt: string; videoPrompt: string; plot: string }[] = [];
  for (let i = 0; i < n; i++) {
    const photoPrompt = await composePhotoPromptLLM({
      characterId: opts.characterId,
      userNote: plots[i],
      poseId: "cowgirl",
      styleId: "warm_lamp_bedroom",
    });
    const videoPrompt = await composeVideoPromptLLM({
      stillPrompt: photoPrompt,
      userNote: plots[i] || opts.plot,
      stillTitle: `Film scene ${i + 1} still`,
      poseId: "cowgirl",
      durationSec,
    });
    planned.push({ photoPrompt, videoPrompt, plot: plots[i] });
  }

  await ollamaUnload();
  requireComfy();
  await ensureComfyReady(40, 2000);

  for (let i = 0; i < n; i++) {
    const generated = await generatePhotoBytes({
      userId: opts.userId,
      characterId: opts.characterId,
      title: `Film scene ${i + 1} still`,
      userNote: planned[i].plot,
      poseId: "cowgirl",
      styleId: "warm_lamp_bedroom",
      composedPrompt: planned[i].photoPrompt,
    });
    const still = await saveStillItem({
      userId: opts.userId,
      characterId: opts.characterId,
      title: generated.title,
      prompt: generated.prompt,
      width: generated.width,
      height: generated.height,
      bytes: generated.bytes,
      meta: generated.meta,
    });
    sceneStillIds.push(still.id);
    width = still.width || width;
    height = still.height || height;
    const size = minimaxSize(width, height);
    const uploaded = await comfyUploadImage(
      `peach_film_${jobId}_s${i + 1}.png`,
      generated.bytes,
    );
    const anatomy = resolveMinimaxLoras(
      planned[i].videoPrompt,
      planned[i].plot,
      planned[i].photoPrompt,
    );
    let videoPrompt = applyAnatomyTriggers(planned[i].videoPrompt, anatomy);
    if (anatomy.useCumshot) videoPrompt = ensureCumshotTrigger(videoPrompt);
    await runComfyJob(
      buildMinimaxI2VGraph({
        imageName: uploaded,
        prompt: videoPrompt,
        width: size.width,
        height: size.height,
        length,
        filenamePrefix: `peach/stitch/${jobId}/s${String(i + 1).padStart(2, "0")}`,
        loras: anatomy.loras,
      }),
      `peach-film-${i + 1}`,
      comfyI2VTimeoutMs(durationSec),
    );
  }

  const stitched = await runComfyJob(
    buildStitchGraph({
      directoryPath: stitchDir,
      filenamePrefix: `peach/film/${jobId}`,
      trimStart: true,
      trimStartSec: 1.0,
    }),
    "peach-stitch",
    comfyStitchTimeoutMs(n),
  );
  let bytes = stitched.bytes;
  let engine = "minimax_h3+autoedit";

  if (opts.withMusic) {
    try {
      const mixed = await maybeMixBgm({
        videoPath: comfyOutputAbsPath(stitched.ref),
        seconds: Math.max(12, n * durationSec),
        filenamePrefix: `peach/film/${jobId}_bgm`,
      });
      bytes = mixed.bytes;
      engine = mixed.engine;
    } catch (e) {
      console.error("[peach] film BGM failed, keeping stitch:", e);
      engine = `${engine}+bgm_fail`;
    }
  }

  if (!bytes?.length || bytes.length < 100) {
    throw new Error("Монтаж вернул пустой файл");
  }

  return {
    bytes,
    prompt: opts.plot,
    title: opts.title || `Mini-film ${n} scenes`,
    width,
    height,
    engine,
    meta: {
      sceneStillIds,
      sceneCount: n,
      withMusic: !!opts.withMusic,
      durationSec,
      stitchDir,
      galleryDir: galleryRoot(),
    },
  };
}

export async function createFilm(opts: Parameters<typeof generateFilmBytes>[0]) {
  const out = await generateFilmBytes(opts);
  const saved = saveGalleryBinary(opts.userId, "mp4", out.bytes, "film");
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: opts.characterId || null,
      kind: "film",
      title: out.title,
      prompt: out.prompt,
      resultUrl: saved.publicUrl,
      width: out.width,
      height: out.height,
      metaJson: JSON.stringify({
        status: "ready",
        ...out.meta,
        localKey: saved.relKey,
        engine: out.engine,
      }),
    },
  });
  backupDatabase("film");
  return item;
}

/** @deprecated use createClip */
export const createMockClip = createClip;

/** @deprecated use createFilm */
export const createMockFilm = createFilm;
