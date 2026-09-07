/**
 * Character identity pack — 5 canonical nude angle stills from lookbook (+ LoRA when ready).
 * Training photos are archived after LoRA train; refs for video come from this pack.
 */
import fs from "fs";
import path from "path";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { BACK_VIEW_LOOKBOOK_FIELD_IDS } from "@/lib/lookbook";
import { hasRealCharacterLora } from "@/lib/tg/studio-cast";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import {
  archiveTrainingPhotos,
  characterRoot,
  listCharacterPhotos,
  trainingPhotosArchived,
} from "@/lib/character-dataset";
import {
  assembleLockedStillPrompt,
  backViewNegative,
  characterIdentityLock,
  cleanShavenNegative,
  loadIdentityCharacters,
  shavedPubicNegative,
  shavedPubicPositive,
} from "@/lib/character-identity";
import { generatePhotoBytes } from "@/lib/peach-lab";
import { galleryRoot } from "@/lib/paths";
import {
  kreaStillSize,
  type VideoOrientationId,
} from "@/lib/video-orientation";

export const IDENTITY_PACK_ANGLES = [
  "front_close",
  "side_close",
  "back_close",
  "front_full",
  "back_full",
] as const;

export type IdentityPackAngleId = (typeof IDENTITY_PACK_ANGLES)[number];

export type IdentityPackAngleState = {
  id: IdentityPackAngleId;
  label: string;
  status: "pending" | "ready" | "error";
  galleryItemId?: string;
  resultUrl?: string;
  width?: number;
  height?: number;
  error?: string;
};

export type IdentityPackManifest = {
  status: "idle" | "generating" | "ready" | "error";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  trainingPhotosArchived?: boolean;
  angles: Record<IdentityPackAngleId, IdentityPackAngleState>;
};

const BACKGROUND =
  "soft gray at the top fading with a smooth gradient downward into peach tones, clean minimal background, even studio lighting, photorealistic";

const ANGLE_TEMPLATES: Record<
  IdentityPackAngleId,
  { label: string; orientation: VideoOrientationId; scene: string }
> = {
  front_close: {
    label: "Спереди, крупный",
    orientation: "4_3",
    scene: `${BACKGROUND}. Frontal eye-level view, camera perfectly centered at eye height, medium close-up framing head and upper body to waist, subject looking straight into the camera, arms relaxed at sides, nude full body visible to waist`,
  },
  side_close: {
    label: "Сбоку, крупный",
    orientation: "4_3",
    scene: `${BACKGROUND}. Pure profile side view, camera at eye height, medium close-up head and upper body to waist, subject looking straight ahead not at the camera, nude`,
  },
  back_close: {
    label: "Сзади, крупный",
    orientation: "4_3",
    scene: `${BACKGROUND}. STRICT rear view only, subject's back fully turned to camera, shoulders and back of head visible, face completely hidden and not visible, looking away from camera, medium close-up head and upper body to waist, nude`,
  },
  front_full: {
    label: "Спереди, всё тело",
    orientation: "5_4",
    scene: `${BACKGROUND}. Frontal eye-level view, full body shot from head to feet in frame, subject looking straight into the camera, standing naturally with feet visible, nude`,
  },
  back_full: {
    label: "Сзади, всё тело",
    orientation: "5_4",
    scene: `${BACKGROUND}. STRICT rear view only, subject's back fully turned to camera, full body from head to feet, face hidden not visible, standing naturally, nude`,
  },
};

function manifestPath(characterId: string) {
  return path.join(characterRoot(characterId), "identity-pack.json");
}

function emptyAngles(): Record<IdentityPackAngleId, IdentityPackAngleState> {
  return Object.fromEntries(
    IDENTITY_PACK_ANGLES.map((id) => [
      id,
      { id, label: ANGLE_TEMPLATES[id].label, status: "pending" as const },
    ]),
  ) as Record<IdentityPackAngleId, IdentityPackAngleState>;
}

export function readIdentityPackManifest(characterId: string): IdentityPackManifest {
  const p = manifestPath(characterId);
  if (!fs.existsSync(p)) {
    return { status: "idle", angles: emptyAngles() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as IdentityPackManifest;
    const angles = { ...emptyAngles(), ...(raw.angles || {}) };
    for (const id of IDENTITY_PACK_ANGLES) {
      angles[id] = {
        ...emptyAngles()[id],
        ...angles[id],
        id,
        label: ANGLE_TEMPLATES[id].label,
      };
    }
    return {
      status: raw.status || "idle",
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
      error: raw.error,
      trainingPhotosArchived: raw.trainingPhotosArchived,
      angles,
    };
  } catch {
    return { status: "idle", angles: emptyAngles() };
  }
}

function writeIdentityPackManifest(characterId: string, manifest: IdentityPackManifest) {
  fs.mkdirSync(characterRoot(characterId), { recursive: true });
  fs.writeFileSync(manifestPath(characterId), JSON.stringify(manifest, null, 2), "utf8");
}

function isBackAngle(angleId: IdentityPackAngleId): boolean {
  return angleId === "back_close" || angleId === "back_full";
}

function showsFrontGenital(angleId: IdentityPackAngleId): boolean {
  return angleId === "front_close" || angleId === "front_full";
}

async function buildAnglePrompt(characterId: string, angleId: IdentityPackAngleId) {
  const ch = await prisma.character.findFirst({ where: { id: characterId } });
  const g = ch?.gender === "male" ? "male" : "female";
  const viewMode = isBackAngle(angleId) ? "back" : "full";
  const forceFieldIds = new Set<string>();
  if (isBackAngle(angleId)) {
    for (const id of BACK_VIEW_LOOKBOOK_FIELD_IDS[g]) forceFieldIds.add(id);
  }
  if (showsFrontGenital(angleId)) {
    forceFieldIds.add("genital_hair");
  }
  const identity = await characterIdentityLock([characterId], {
    viewMode,
    forceFieldIds: forceFieldIds.size ? forceFieldIds : undefined,
  });
  let scene = ANGLE_TEMPLATES[angleId].scene;
  const pubicLine = showsFrontGenital(angleId) ? shavedPubicPositive(identity.rows) : "";
  if (pubicLine) scene = `${scene}, ${pubicLine}`;
  return assembleLockedStillPrompt({ identity, scene });
}

function identityPackExtraNegative(
  angleId: IdentityPackAngleId,
  rows: Awaited<ReturnType<typeof loadIdentityCharacters>>,
): string {
  const parts = [
    shavedPubicNegative(rows, { always: true }),
    cleanShavenNegative(rows),
    isBackAngle(angleId) ? backViewNegative() : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export async function getIdentityPackPublic(
  userId: string,
  characterId: string,
): Promise<IdentityPackManifest & { trainingPhotosArchived: boolean }> {
  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId },
  });
  if (!ch) throw new Error("character not found");
  const manifest = readIdentityPackManifest(characterId);
  const archived = manifest.trainingPhotosArchived || trainingPhotosArchived(characterId);

  for (const id of IDENTITY_PACK_ANGLES) {
    const slot = manifest.angles[id];
    if (!slot.galleryItemId) continue;
    const item = await prisma.galleryItem.findFirst({
      where: { id: slot.galleryItemId, userId, characterId },
    });
    if (!item || item.resultUrl === GALLERY_PLACEHOLDER_URL) {
      manifest.angles[id] = { ...slot, status: slot.status === "ready" ? "pending" : slot.status };
      continue;
    }
    const meta = JSON.parse(item.metaJson || "{}") as { status?: string; error?: string };
    manifest.angles[id] = {
      ...slot,
      status: meta.status === "error" ? "error" : "ready",
      resultUrl: item.resultUrl,
      width: item.width || undefined,
      height: item.height || undefined,
      error: typeof meta.error === "string" ? meta.error : slot.error,
    };
  }

  const allReady = IDENTITY_PACK_ANGLES.every(
    (id) => manifest.angles[id].status === "ready" && manifest.angles[id].resultUrl,
  );
  if (allReady && manifest.status !== "ready") {
    manifest.status = "ready";
    manifest.finishedAt = manifest.finishedAt || new Date().toISOString();
    writeIdentityPackManifest(characterId, manifest);
  }

  return { ...manifest, trainingPhotosArchived: archived };
}

async function createPendingAngleItem(opts: {
  userId: string;
  characterId: string;
  angleId: IdentityPackAngleId;
  prompt: string;
  width: number;
  height: number;
}) {
  const tpl = ANGLE_TEMPLATES[opts.angleId];
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: opts.characterId,
      kind: "photo",
      title: `Identity · ${tpl.label}`,
      prompt: opts.prompt,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      width: opts.width,
      height: opts.height,
      metaJson: JSON.stringify({
        status: "pending",
        galleryDir: galleryRoot(),
        identityPack: true,
        identityPackAngle: opts.angleId,
        jobAction: "identity_pack",
      }),
    },
  });
  backupDatabase("identity-pack-pending");
  return item;
}

async function markAngleReady(
  itemId: string,
  userId: string,
  data: {
    resultUrl: string;
    prompt: string;
    width: number;
    height: number;
    engine: string;
    localKey: string;
    angleId: IdentityPackAngleId;
    seed: number;
  },
) {
  await prisma.galleryItem.update({
    where: { id: itemId },
    data: {
      resultUrl: data.resultUrl,
      width: data.width,
      height: data.height,
      prompt: data.prompt,
      metaJson: JSON.stringify({
        status: "ready",
        identityPack: true,
        identityPackAngle: data.angleId,
        jobAction: "identity_pack",
        localKey: data.localKey,
        engine: data.engine,
        seed: data.seed,
        skinDetail: false,
      }),
    },
  });
}

async function markAngleError(itemId: string, userId: string, error: string, angleId: IdentityPackAngleId) {
  const existing = await prisma.galleryItem.findFirst({ where: { id: itemId, userId } });
  if (!existing) return;
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(existing.metaJson || "{}") as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  await prisma.galleryItem.update({
    where: { id: itemId },
    data: {
      metaJson: JSON.stringify({
        ...prev,
        status: "error",
        error,
        identityPack: true,
        identityPackAngle: angleId,
      }),
    },
  });
}

async function runIdentityPackGeneration(opts: {
  userId: string;
  characterId: string;
  archiveTraining: boolean;
}) {
  const ch = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId },
  });
  if (!ch) throw new Error("character not found");

  let manifest = readIdentityPackManifest(opts.characterId);
  manifest = {
    ...manifest,
    status: "generating",
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    error: undefined,
    angles: emptyAngles(),
  };
  writeIdentityPackManifest(opts.characterId, manifest);

  if (opts.archiveTraining && listCharacterPhotos(opts.characterId).length > 0) {
    archiveTrainingPhotos(opts.characterId);
    await prisma.character.update({
      where: { id: opts.characterId },
      data: { photoCount: 0 },
    });
    manifest.trainingPhotosArchived = true;
    writeIdentityPackManifest(opts.characterId, manifest);
  }

  const useLora = hasRealCharacterLora(ch);
  let hadError = false;

  for (const angleId of IDENTITY_PACK_ANGLES) {
    const tpl = ANGLE_TEMPLATES[angleId];
    const size = kreaStillSize(tpl.orientation);
    const prompt = await buildAnglePrompt(opts.characterId, angleId);
    const pending = await createPendingAngleItem({
      userId: opts.userId,
      characterId: opts.characterId,
      angleId,
      prompt,
      width: size.width,
      height: size.height,
    });

    manifest = readIdentityPackManifest(opts.characterId);
    manifest.angles[angleId] = {
      id: angleId,
      label: tpl.label,
      status: "pending",
      galleryItemId: pending.id,
    };
    writeIdentityPackManifest(opts.characterId, manifest);

    try {
      const chRow = await prisma.character.findFirst({ where: { id: opts.characterId } });
      const g = chRow?.gender === "male" ? "male" : "female";
      const forceIds = new Set<string>();
      if (isBackAngle(angleId)) {
        for (const id of BACK_VIEW_LOOKBOOK_FIELD_IDS[g]) forceIds.add(id);
      }
      if (showsFrontGenital(angleId)) forceIds.add("genital_hair");
      const idRows = await loadIdentityCharacters([opts.characterId], {
        viewMode: isBackAngle(angleId) ? "back" : "full",
        forceFieldIds: forceIds.size ? forceIds : undefined,
      });
      const out = await generatePhotoBytes({
        userId: opts.userId,
        characterId: opts.characterId,
        characterIds: [opts.characterId],
        composedPrompt: prompt,
        width: size.width,
        height: size.height,
        title: `Identity · ${tpl.label}`,
        usePreset: false,
        useCharacterLora: useLora,
        skinDetail: false,
        extraNegativeAppend: identityPackExtraNegative(angleId, idRows),
      });
      const saved = saveGalleryBinary(opts.userId, "png", out.bytes, "identity");
      await markAngleReady(pending.id, opts.userId, {
        resultUrl: saved.publicUrl,
        prompt: out.prompt,
        width: out.width,
        height: out.height,
        engine: out.engine,
        localKey: saved.relKey,
        angleId,
        seed: out.seed,
      });

      manifest = readIdentityPackManifest(opts.characterId);
      manifest.angles[angleId] = {
        id: angleId,
        label: tpl.label,
        status: "ready",
        galleryItemId: pending.id,
        resultUrl: saved.publicUrl,
        width: out.width,
        height: out.height,
      };
      writeIdentityPackManifest(opts.characterId, manifest);
    } catch (e) {
      hadError = true;
      const msg = e instanceof Error ? e.message : String(e);
      await markAngleError(pending.id, opts.userId, msg, angleId);
      manifest = readIdentityPackManifest(opts.characterId);
      manifest.angles[angleId] = {
        id: angleId,
        label: tpl.label,
        status: "error",
        galleryItemId: pending.id,
        error: msg,
      };
      manifest.status = "error";
      manifest.error = msg;
      writeIdentityPackManifest(opts.characterId, manifest);
    }
  }

  manifest = readIdentityPackManifest(opts.characterId);
  const allReady = IDENTITY_PACK_ANGLES.every((id) => manifest.angles[id].status === "ready");
  manifest.status = hadError && !allReady ? "error" : allReady ? "ready" : "error";
  manifest.finishedAt = new Date().toISOString();
  writeIdentityPackManifest(opts.characterId, manifest);
  backupDatabase("identity-pack-done");
}

export async function startIdentityPackGeneration(opts: {
  userId: string;
  characterId: string;
  /** Move training photos to archive (default true when LoRA ready). */
  archiveTraining?: boolean;
}) {
  const ch = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId },
  });
  if (!ch) throw new Error("character not found");

  const manifest = readIdentityPackManifest(opts.characterId);
  if (manifest.status === "generating") {
    return { ok: true as const, alreadyRunning: true, manifest };
  }

  const archiveTraining =
    opts.archiveTraining ??
    (ch.loraStatus === "lora_ready" && listCharacterPhotos(opts.characterId).length > 0);

  after(() => {
    void enqueueGpuJob(
      () =>
        runIdentityPackGeneration({
          userId: opts.userId,
          characterId: opts.characterId,
          archiveTraining,
        }),
      {
        kind: "identity_pack",
        pool: "photo",
        userId: opts.userId,
        refType: "character",
        refId: opts.characterId,
        title: `identity-pack ${opts.characterId}`,
      },
    );
  });

  return {
    ok: true as const,
    alreadyRunning: false,
    message: "Генерация базовых ракурсов запущена (5 кадров, ~5–10 мин)",
  };
}

/** Called once when LoRA train finishes — archive dataset + generate identity pack. */
export async function scheduleIdentityPackAfterTrain(userId: string, characterId: string) {
  const manifest = readIdentityPackManifest(characterId);
  if (manifest.status === "ready" || manifest.status === "generating") return;

  return startIdentityPackGeneration({
    userId,
    characterId,
    archiveTraining: true,
  });
}

type GalleryRow = Awaited<
  ReturnType<typeof prisma.galleryItem.findFirst>
> & {};

/** Gallery items for current identity pack only (manifest wins; no stale regen duplicates). */
export async function listIdentityPackGalleryItems(userId: string, characterId: string) {
  const manifest = readIdentityPackManifest(characterId);
  const fromManifest: NonNullable<GalleryRow>[] = [];

  for (const angleId of IDENTITY_PACK_ANGLES) {
    const slot = manifest.angles[angleId];
    if (!slot?.galleryItemId || slot.status !== "ready") continue;
    const item = await prisma.galleryItem.findFirst({
      where: { id: slot.galleryItemId, userId, characterId },
    });
    if (item && item.resultUrl !== GALLERY_PLACEHOLDER_URL) {
      fromManifest.push(item);
    }
  }
  if (fromManifest.length) return fromManifest;

  // Fallback: dedupe legacy rows by angle — keep newest per angle only.
  const items = await prisma.galleryItem.findMany({
    where: {
      userId,
      characterId,
      kind: "photo",
      NOT: { resultUrl: GALLERY_PLACEHOLDER_URL },
    },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  const deduped: typeof items = [];
  for (const it of items) {
    try {
      const m = JSON.parse(it.metaJson || "{}") as {
        identityPack?: boolean;
        identityPackAngle?: string;
      };
      if (!m.identityPack) continue;
      const key = m.identityPackAngle || it.id;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    } catch {
      /* skip */
    }
  }
  deduped.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return deduped.slice(0, IDENTITY_PACK_ANGLES.length);
}
