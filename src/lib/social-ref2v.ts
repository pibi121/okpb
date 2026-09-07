/**
 * Social template runs: Krea still → user approve → Ref2VA READY video.
 */
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import {
  assembleLockedStillPrompt,
  characterIdentityLock,
} from "@/lib/character-identity";
import { generatePhotoBytes, localBytesFromResultUrl } from "@/lib/peach-lab";
import {
  runCharacterRef2VAReady,
  type Ref2VAOrientation,
} from "@/lib/ref2va-ready-lab";
import { getSocialTemplateInternal } from "@/lib/social-templates";
import {
  socialLocationNegative,
  socialWardrobeNegative,
} from "@/lib/social-wardrobe";
import { composeSocialWardrobeLLM } from "@/lib/social-wardrobe-llm";

export type PublicSocialRun = {
  id: string;
  templateId: string | null;
  characterId: string | null;
  title: string;
  status: string;
  kreaPhotoUrl: string;
  resultVideoUrl: string;
  width: number;
  height: number;
  durationSec: number;
  error: string | null;
  engine: string | null;
  clothed: boolean;
  wardrobeNote: string;
  orientation: string;
  /** JSON: wardrobeSource, wardrobeLine, wardrobeDetailEn, userWardrobeNote */
  prompt: string;
  createdAt: string;
  updatedAt: string;
  template?: { id: string; title: string; previewVideoUrl: string };
};

function toPublic(row: {
  id: string;
  templateId: string | null;
  characterId: string | null;
  title: string;
  status: string;
  kreaPhotoUrl: string;
  resultVideoUrl: string;
  width: number;
  height: number;
  durationSec: number;
  error: string | null;
  engine: string | null;
  clothed?: boolean;
  wardrobeNote?: string;
  orientation?: string;
  prompt?: string;
  createdAt: Date;
  updatedAt: Date;
  template?: { id: string; title: string; previewVideoUrl: string } | null;
}): PublicSocialRun {
  return {
    id: row.id,
    templateId: row.templateId,
    characterId: row.characterId,
    title: row.title,
    status: row.status,
    kreaPhotoUrl: row.kreaPhotoUrl,
    resultVideoUrl: row.resultVideoUrl,
    width: row.width,
    height: row.height,
    durationSec: row.durationSec,
    error: row.error,
    engine: row.engine,
    clothed: !!row.clothed,
    wardrobeNote: row.wardrobeNote || "",
    orientation: row.orientation || "match_photo",
    prompt: row.prompt || "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    template: row.template
      ? {
          id: row.template.id,
          title: row.template.title,
          previewVideoUrl: row.template.previewVideoUrl,
        }
      : undefined,
  };
}

export async function listSocialRuns(userId: string) {
  const rows = await prisma.socialRef2VRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      template: {
        select: { id: true, title: true, previewVideoUrl: true },
      },
    },
  });
  return rows.map(toPublic);
}

export async function getSocialRun(userId: string, id: string) {
  const row = await prisma.socialRef2VRun.findFirst({
    where: { id, userId },
    include: {
      template: {
        select: { id: true, title: true, previewVideoUrl: true },
      },
    },
  });
  return row ? toPublic(row) : null;
}

async function runKreaPhotoStep(runId: string, userId: string) {
  const run = await prisma.socialRef2VRun.findFirst({
    where: { id: runId, userId },
  });
  if (!run?.templateId) throw new Error("run missing template");

  const tpl = await getSocialTemplateInternal(userId, run.templateId);
  if (!tpl?.drivingVideoUrl) throw new Error("У шаблона нет driving video");

  const clothed = !!run.clothed;
  const wardrobeNote = run.wardrobeNote || "";
  const characterIds = run.characterId ? [run.characterId] : [];
  const identity = characterIds.length
    ? await characterIdentityLock(characterIds, {
        skipIntimate: clothed && !wardrobeNote.trim(),
      })
    : null;
  const scene = tpl.kreaPhotoPrompt.trim();
  const wardrobe = await composeSocialWardrobeLLM({
    clothed,
    wardrobeNote,
    sceneHint: scene,
  });
  const wardrobeLine = wardrobe.wardrobeLine;
  const locNeg = socialLocationNegative(scene);
  const sceneGuarded = locNeg
    ? `${scene}. LOCATION LOCK: keep this location exactly. No bed, no bedroom, no mattress, no pillows.`
    : scene;
  const prompt = identity
    ? assembleLockedStillPrompt({
        identity,
        scene: sceneGuarded,
        wardrobeLine,
      })
    : [wardrobeLine, sceneGuarded].filter(Boolean).join(" ");

  // When nude, leave negativePrompt unset so Krea keeps default (bans clothes).
  // When clothed, override with wardrobe-aware negative (+ bed ban if needed).
  const wardNeg = socialWardrobeNegative(clothed, wardrobeNote);
  const negativePrompt = clothed
    ? [wardNeg, locNeg].filter(Boolean).join(", ") || undefined
    : undefined;

  const out = await generatePhotoBytes({
    userId,
    characterIds,
    characterId: run.characterId,
    title: `${run.title} · Krea still`,
    composedPrompt: prompt,
    // Pass scene as userNote so locationFurnitureNegative sees no bed
    userNote: scene,
    clothed,
    skinDetail: true,
    skinDetailStrength: 1.2,
    width: 888,
    height: 1176,
    negativePrompt,
  });

  const saved = saveGalleryBinary(userId, "png", out.bytes, `social_krea_${runId}`);
  await prisma.socialRef2VRun.update({
    where: { id: runId },
    data: {
      status: "awaiting_photo",
      kreaPhotoUrl: saved.publicUrl,
      drivingVideoUrl: tpl.drivingVideoUrl,
      width: out.width,
      height: out.height,
      error: null,
      engine: out.engine,
      prompt: JSON.stringify({
        wardrobeSource: wardrobe.source,
        wardrobeLine,
        wardrobeDetailEn: wardrobe.detailEn || null,
        userWardrobeNote: wardrobeNote,
      }),
    },
  });
  backupDatabase("social-krea");
}

async function runRef2VAStep(runId: string, userId: string) {
  const run = await prisma.socialRef2VRun.findFirst({
    where: { id: runId, userId },
  });
  if (!run?.templateId) throw new Error("run missing template");

  const tpl = await getSocialTemplateInternal(userId, run.templateId);
  if (!tpl) throw new Error("template not found");

  const photoBytes = localBytesFromResultUrl(run.kreaPhotoUrl);
  if (!photoBytes?.length) throw new Error("Krea photo missing on disk");

  const driveBytes = localBytesFromResultUrl(tpl.drivingVideoUrl);
  if (!driveBytes?.length) throw new Error("Template video missing on disk");

  const orientation = (run.orientation || "match_photo") as Ref2VAOrientation;

  const out = await runCharacterRef2VAReady({
    characterPhotoBytes: photoBytes,
    drivingVideoBytes: driveBytes,
    scenePrompt: tpl.scenePrompt || undefined,
    motionPrompt: tpl.motionPrompt || undefined,
    sam3Target: tpl.sam3Target,
    durationSec: tpl.durationSec,
    filenamePrefix: `peach/social-ref2va/${runId}`,
    orientation,
    photoWidth: run.width,
    photoHeight: run.height,
  });

  const saved = saveGalleryBinary(
    userId,
    "mp4",
    out.bytes,
    `social_ref2va_${runId}`,
  );

  await prisma.galleryItem.create({
    data: {
      userId,
      characterId: run.characterId,
      kind: "video",
      title: `${run.title} · Social`,
      prompt: tpl.kreaPhotoPrompt,
      resultUrl: saved.publicUrl,
      width: out.width,
      height: out.height,
      metaJson: JSON.stringify({
        status: "ready",
        socialRef2VRunId: runId,
        templateId: tpl.id,
        engine: out.engine,
        localKey: saved.relKey,
        durationSec: out.durationSec,
        orientation,
        clothed: run.clothed,
      }),
    },
  });

  await prisma.socialRef2VRun.update({
    where: { id: runId },
    data: {
      status: "ready",
      resultVideoUrl: saved.publicUrl,
      durationSec: out.durationSec,
      width: out.width,
      height: out.height,
      engine: out.engine,
      error: null,
    },
  });
  backupDatabase("social-ref2va");
}

function scheduleGpu(fn: () => Promise<void>, opts?: import("@/lib/gpu/types").GpuEnqueueOpts) {
  after(() => {
    void enqueueGpuJob(fn, opts);
  });
}

export async function startSocialRun(opts: {
  userId: string;
  templateId: string;
  characterId: string;
  title?: string;
  clothed?: boolean;
  wardrobeNote?: string;
  orientation?: Ref2VAOrientation;
}) {
  const tpl = await getSocialTemplateInternal(opts.userId, opts.templateId);
  if (!tpl?.published) throw new Error("Шаблон недоступен");
  if (!tpl.drivingVideoUrl) throw new Error("Шаблон без видео");

  const ch = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId },
  });
  if (!ch) throw new Error("Персонаж не найден");

  const clothed = !!opts.clothed;
  const wardrobeNote = clothed ? (opts.wardrobeNote || "").trim() : "";
  const orientation = opts.orientation || "match_photo";

  const run = await prisma.socialRef2VRun.create({
    data: {
      userId: opts.userId,
      templateId: opts.templateId,
      characterId: opts.characterId,
      title: opts.title?.trim() || `${tpl.title} · ${ch.name}`,
      status: "krea_busy",
      drivingVideoUrl: tpl.drivingVideoUrl,
      durationSec: tpl.durationSec,
      clothed,
      wardrobeNote,
      orientation,
    },
  });

  scheduleGpu(async () => {
    try {
      await runKreaPhotoStep(run.id, opts.userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[peach] social krea failed:", msg);
      await prisma.socialRef2VRun.update({
        where: { id: run.id },
        data: { status: "error", error: msg },
      });
      void import("@/lib/gpu/orchestrator")
        .then(({ noteGpuJobError }) => noteGpuJobError(msg))
        .catch(() => undefined);
    }
  }, {
    kind: "photo",
    pool: "photo",
    userId: opts.userId,
    refType: "socialRef2VRun",
    refId: run.id,
    title: run.title,
  });

  return getSocialRun(opts.userId, run.id);
}

export async function approveSocialRunPhoto(userId: string, runId: string) {
  const run = await prisma.socialRef2VRun.findFirst({
    where: { id: runId, userId },
  });
  if (!run) throw new Error("run not found");
  if (run.status !== "awaiting_photo") {
    if (!(run.status === "error" && run.kreaPhotoUrl)) {
      throw new Error("Фото ещё не готово или уже отправлено в видео");
    }
  }

  await prisma.socialRef2VRun.update({
    where: { id: runId },
    data: { status: "video_busy", error: null },
  });

  scheduleGpu(async () => {
    try {
      await runRef2VAStep(runId, userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[peach] social ref2va failed:", msg);
      await prisma.socialRef2VRun.update({
        where: { id: runId },
        data: { status: "error", error: msg },
      });
      void import("@/lib/gpu/orchestrator")
        .then(({ noteGpuJobError }) => noteGpuJobError(msg))
        .catch(() => undefined);
    }
  }, {
    kind: "video",
    pool: "video",
    userId,
    refType: "socialRef2VRun",
    refId: runId,
    title: `social-video ${runId}`,
  });

  return getSocialRun(userId, runId);
}

export async function regenSocialRunPhoto(userId: string, runId: string) {
  const run = await prisma.socialRef2VRun.findFirst({
    where: { id: runId, userId },
  });
  if (!run) throw new Error("run not found");
  if (run.status !== "awaiting_photo" && run.status !== "error") {
    throw new Error("Перегенерация фото доступна после preview");
  }

  await prisma.socialRef2VRun.update({
    where: { id: runId },
    data: { status: "krea_busy", error: null },
  });

  scheduleGpu(async () => {
    try {
      await runKreaPhotoStep(runId, userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.socialRef2VRun.update({
        where: { id: runId },
        data: { status: "error", error: msg },
      });
      void import("@/lib/gpu/orchestrator")
        .then(({ noteGpuJobError }) => noteGpuJobError(msg))
        .catch(() => undefined);
    }
  }, {
    kind: "photo",
    pool: "photo",
    userId,
    refType: "socialRef2VRun",
    refId: runId,
    title: `social-regen ${runId}`,
  });

  return getSocialRun(userId, runId);
}
