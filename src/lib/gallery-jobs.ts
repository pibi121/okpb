import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import {
  GALLERY_PLACEHOLDER_URL,
  type GalleryMeta,
} from "@/lib/gallery-meta";
import { resolveCharacterIds } from "@/lib/character-ids";
import {
  generateClipBytes,
  generateFilmBytes,
  generatePhotoBytes,
} from "@/lib/peach-lab";
import { galleryRoot } from "@/lib/paths";
import { localBytesFromResultUrl } from "@/lib/peach-lab";

type PhotoPayload = Parameters<typeof generatePhotoBytes>[0] & {
  templateRunFrameId?: string;
  legoQuery?: string;
  orientationId?: string;
  customIdentityBuffers?: Buffer[];
  manualSlots?: import("@/lib/photo-refs-shared").PhotoManualSlot[];
  useIdentityDualRef?: boolean;
  /** House LoRA model — TG template via Krea T2I, not identity dual-ref. */
  studioCastLora?: boolean;
};
type ClipPayload = Parameters<typeof generateClipBytes>[0] & {
  templatePackId?: string;
  templateFrameId?: string;
  templateRunFrameId?: string;
};
type FilmPayload = Parameters<typeof generateFilmBytes>[0];

/** One GPU job at a time — parallel MiniMax/Krea/Ollama thrash VRAM and hit timeouts.
 * Each job is also logged to GpuJob (DB) for /ops/load + redeploy visibility.
 */
let peachJobTail: Promise<void> = Promise.resolve();

export type { GpuEnqueueOpts } from "@/lib/gpu/types";

export function enqueueGpuJob(
  fn: () => Promise<void>,
  opts?: import("@/lib/gpu/types").GpuEnqueueOpts,
): Promise<void> {
  const run = peachJobTail.then(
    async () => {
      const { gpuQueueOnStart, gpuQueueOnFinish } = await import("@/lib/ops/queue");
      const { runTrackedGpuJob } = await import("@/lib/gpu/orchestrator");
      gpuQueueOnStart();
      try {
        await runTrackedGpuJob(fn, opts);
      } finally {
        gpuQueueOnFinish();
      }
    },
    async () => {
      const { gpuQueueOnStart, gpuQueueOnFinish } = await import("@/lib/ops/queue");
      const { runTrackedGpuJob } = await import("@/lib/gpu/orchestrator");
      gpuQueueOnStart();
      try {
        await runTrackedGpuJob(fn, opts);
      } finally {
        gpuQueueOnFinish();
      }
    },
  );
  peachJobTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function createPendingItem(opts: {
  userId: string;
  kind: string;
  title: string;
  prompt?: string;
  characterId?: string | null;
  sourceUrl?: string | null;
  width?: number | null;
  height?: number | null;
  meta?: GalleryMeta;
}) {
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: opts.characterId || null,
      kind: opts.kind,
      title: opts.title,
      prompt: opts.prompt || null,
      sourceUrl: opts.sourceUrl || null,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      width: opts.width ?? null,
      height: opts.height ?? null,
      metaJson: JSON.stringify({
        status: "pending",
        galleryDir: galleryRoot(),
        ...opts.meta,
      }),
    },
  });
  backupDatabase("gallery-pending");
  return item;
}

async function markReady(
  itemId: string,
  userId: string,
  data: {
    resultUrl: string;
    meta: Record<string, unknown>;
    width?: number;
    height?: number;
    prompt?: string;
    title?: string;
    sourceUrl?: string | null;
  },
) {
  const existing = await prisma.galleryItem.findFirst({
    where: { id: itemId, userId },
  });
  if (!existing) return;
  await prisma.galleryItem.update({
    where: { id: itemId },
    data: {
      resultUrl: data.resultUrl,
      width: data.width,
      height: data.height,
      prompt: data.prompt,
      title: data.title,
      sourceUrl: data.sourceUrl,
      metaJson: JSON.stringify({ ...data.meta, status: "ready" }),
    },
  });
  backupDatabase("gallery");
}

async function markError(itemId: string, userId: string, error: string, meta: GalleryMeta = {}) {
  const existing = await prisma.galleryItem.findFirst({
    where: { id: itemId, userId },
  });
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
        ...meta,
        status: "error",
        error,
      }),
    },
  });
  backupDatabase("gallery-error");
  void import("@/lib/gpu/orchestrator")
    .then(async ({ noteGpuJobError, currentGpuJobId }) => {
      if (currentGpuJobId()) {
        await noteGpuJobError(error, {
          itemId,
          ...(meta as Record<string, unknown>),
        });
        return;
      }
      const { reportOpsError } = await import("@/lib/ops/errors");
      await reportOpsError({
        kind: "generation",
        message: error,
        userId,
        stage: "error",
        refType: "galleryItem",
        refId: itemId,
        meta: { itemId, ...(meta as Record<string, unknown>) },
      });
    })
    .catch(() => undefined);
}

function isTransientJobError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
  return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|HTTP timeout|Comfy недоступен|Ollama|туннель|tunnel|LLM|ENOSPC|no space left/i.test(
    `${msg} ${code}`,
  );
}

async function runPhotoJob(itemId: string, userId: string, opts: PhotoPayload) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { templateRunFrameId: _runFrameId, ...photoOpts } = opts;
      const characterIds = resolveCharacterIds(photoOpts);
      const isTgTemplate = !!photoOpts.tgPhotoTemplateId;
      const isTemplate = !!photoOpts.photoTemplateId;
      const useDual =
        !photoOpts.studioCastLora &&
        (isTgTemplate || isTemplate || photoOpts.useIdentityDualRef);

      let dualRefPersonBuffer: Buffer | undefined;
      let dualRefSceneBuffer: Buffer | undefined;

      if (useDual) {
        const { resolvePhotoPersonBuffer } = await import("@/lib/photo-refs");
        const castIds = isTemplate || isTgTemplate
          ? characterIds.filter((id) => id && !id.startsWith("custom:"))
          : characterIds;
        const person = await resolvePhotoPersonBuffer({
          userId,
          characterIds: castIds.length ? castIds : characterIds,
          customIdentityBuffers: photoOpts.customIdentityBuffers,
          manualSlots: photoOpts.manualSlots,
        });
        if (!person?.length) {
          throw new Error(
            "Нужно фото лица: загрузи снимок или выбери персонажа с рефами",
          );
        }
        dualRefPersonBuffer = person;

        if (isTgTemplate && photoOpts.tgPhotoTemplateId) {
          // Do NOT use the author's preview RGB as the dual-ref scene — it
          // bakes hair/body identity. peach-lab will synthesize a scene plate
          // from the sanitized scene-only prompt, then lock the viewer's face.
          const { getTgPhotoTemplateForGeneration } = await import(
            "@/lib/tg-photo-template-lab"
          );
          const tpl = await getTgPhotoTemplateForGeneration(
            photoOpts.tgPhotoTemplateId,
          );
          if (tpl?.editPrompt && !photoOpts.composedPrompt?.trim()) {
            const { composePhotoTemplatePromptForCharacter } = await import(
              "@/lib/tg/template-prompt"
            );
            photoOpts.composedPrompt =
              await composePhotoTemplatePromptForCharacter({
                templateEditPrompt: tpl.editPrompt,
                characterIds: castIds.length ? castIds : characterIds,
                sceneOnly: useDual,
              });
          }
        } else if (isTemplate && photoOpts.photoTemplateId) {
          const { resolvePhotoTemplateSceneBuffer } = await import(
            "@/lib/photo-refs"
          );
          dualRefSceneBuffer =
            (await resolvePhotoTemplateSceneBuffer(
              userId,
              photoOpts.photoTemplateId,
            )) || undefined;
          if (!dualRefSceneBuffer?.length) {
            throw new Error("Шаблон без превью-сцены — пересохрани шаблон");
          }
        }
      }

      const out = await generatePhotoBytes({
        ...photoOpts,
        userId,
        characterIds: isTemplate || isTgTemplate
          ? characterIds.filter((id) => !id.startsWith("custom:")).length
            ? characterIds.filter((id) => !id.startsWith("custom:"))
            : characterIds
          : characterIds,
        dualRefPersonBuffer,
        dualRefSceneBuffer,
        useIdentityDualRef: !!dualRefPersonBuffer && useDual,
      });
      const saved = saveGalleryBinary(userId, "png", out.bytes, out.prefix);
      await markReady(itemId, userId, {
        resultUrl: saved.publicUrl,
        width: out.width,
        height: out.height,
        prompt: out.prompt,
        title: out.title,
        sourceUrl: out.sourceUrl,
        meta: { ...out.meta, localKey: saved.relKey, engine: out.engine },
      });
      const { notifyTelegramMediaReady } = await import("@/lib/tg/tg-notify");
      await notifyTelegramMediaReady({
        userId,
        kind: "photo",
        mediaUrl: saved.publicUrl,
        caption: out.title || "Photo",
      }).catch((e) => console.error("[peach] tg photo notify:", e));
      if (opts.templateRunFrameId) {
        await prisma.templateRunFrame.updateMany({
          where: { id: opts.templateRunFrameId },
          data: { stillItemId: itemId },
        });
      }
      return;
    } catch (e) {
      lastErr = e;
      if (!isTransientJobError(e) || attempt === 2) break;
      console.warn(
        `[peach] photo job retry ${attempt + 1}/3 after transient:`,
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : "ошибка генерации";
  console.error("[peach] photo job failed:", lastErr);
  await markError(itemId, userId, msg, { jobAction: "photo" });
  const { notifyTelegramGenerationError } = await import("@/lib/tg/tg-notify");
  await notifyTelegramGenerationError(userId, msg).catch(() => undefined);
}

async function runClipJob(itemId: string, userId: string, opts: ClipPayload) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await generateClipBytes({ ...opts, userId });
      const saved = saveGalleryBinary(userId, "mp4", out.bytes, "clip");
      await markReady(itemId, userId, {
        resultUrl: saved.publicUrl,
        width: out.width,
        height: out.height,
        prompt: out.prompt,
        title: out.title,
        sourceUrl: out.sourceUrl,
        meta: { ...out.meta, localKey: saved.relKey, engine: out.engine },
      });
      if (opts.templateFrameId && opts.templatePackId) {
        await prisma.templateFrame.updateMany({
          where: { id: opts.templateFrameId, packId: opts.templatePackId },
          data: {
            clipItemId: itemId,
            videoPrompt: out.prompt || opts.composedPrompt || opts.plot || "",
            durationSec: opts.durationSec || undefined,
            status: "draft",
          },
        });
      }
      if (opts.templateRunFrameId) {
        await prisma.templateRunFrame.updateMany({
          where: { id: opts.templateRunFrameId },
          data: {
            clipItemId: itemId,
            videoPrompt: out.prompt || opts.composedPrompt || opts.plot || "",
            durationSec: opts.durationSec || undefined,
          },
        });
      }
      return;
    } catch (e) {
      lastErr = e;
      if (!isTransientJobError(e) || attempt === 2) break;
      console.warn(
        `[peach] clip job retry ${attempt + 1}/3 after transient:`,
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : "ошибка клипа";
  console.error("[peach] clip job failed:", lastErr);
  await markError(itemId, userId, msg, { jobAction: "clip" });
}

async function runFilmJob(itemId: string, userId: string, opts: FilmPayload) {
  try {
    const out = await generateFilmBytes({ ...opts, userId });
    const saved = saveGalleryBinary(userId, "mp4", out.bytes, "film");
    await markReady(itemId, userId, {
      resultUrl: saved.publicUrl,
      width: out.width,
      height: out.height,
      prompt: out.prompt,
      title: out.title,
      meta: { ...out.meta, localKey: saved.relKey, engine: out.engine },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка фильма";
    console.error("[peach] film job failed:", e);
    await markError(itemId, userId, msg, { jobAction: "film" });
  }
}

function scheduleJob(
  fn: () => Promise<void>,
  opts?: import("@/lib/gpu/types").GpuEnqueueOpts,
) {
  // Start on the GPU queue immediately. Do not rely on Next `after()` —
  // I2V can run 15–25+ min and must not depend on request lifecycle hooks.
  void enqueueGpuJob(fn, opts);
}

export async function enqueuePhotoJob(userId: string, opts: PhotoPayload) {
  const width = opts.width ?? 888;
  const height = opts.height ?? 1176;
  const characterIds = resolveCharacterIds(opts);
  const prompt =
    opts.composedPrompt?.trim() ||
    opts.userNote?.trim() ||
    (opts.editPrompt ? `Edit: ${opts.editPrompt.trim()}` : "LLM prompt…");
  const item = await createPendingItem({
    userId,
    kind: "photo",
    title: opts.title || (opts.editPrompt ? "Edited still" : "Peach still"),
    prompt,
    characterId: characterIds[0] || opts.characterId || null,
    width,
    height,
    meta: {
      jobAction: opts.editPrompt ? "edit" : opts.editOfId ? "regen" : "photo",
      poseId: opts.poseId,
      styleId: opts.styleId,
      characterIds,
      usePreset: opts.usePreset !== false,
      presetId: opts.presetId || null,
      userNote: opts.userNote || "",
      legoQuery: opts.legoQuery || opts.userNote || "",
      orientationId: opts.orientationId || null,
      includeMale: !!opts.includeMale,
      clothed: !!opts.clothed,
      pokies: !!(opts.clothed && opts.pokies),
      skinDetail: opts.skinDetail,
      skinDetailStrength: opts.skinDetailStrength,
      photoTemplateId: opts.photoTemplateId || null,
      tgPhotoTemplateId: opts.tgPhotoTemplateId || null,
      useIdentityDualRef:
        opts.useIdentityDualRef ||
        !!opts.photoTemplateId ||
        !!opts.tgPhotoTemplateId,
    },
  });
  scheduleJob(() => runPhotoJob(item.id, userId, opts), {
    kind: "photo",
    pool: "photo",
    userId,
    refType: "galleryItem",
    refId: item.id,
    title: item.title || undefined,
    meta: {
      studioCastLora: !!opts.studioCastLora,
      tgPhotoTemplateId: opts.tgPhotoTemplateId || null,
    },
  });
  return item;
}

export async function enqueueClipJob(userId: string, opts: ClipPayload) {
  const item = await createPendingItem({
    userId,
    kind: "video",
    title: opts.title || "1 clip",
    prompt: opts.plot,
    characterId: opts.characterId || null,
    meta: {
      jobAction: "clip",
      stillId: opts.stillId,
      withMusic: !!opts.withMusic,
      durationSec: opts.durationSec,
      templatePackId: opts.templatePackId,
      templateFrameId: opts.templateFrameId,
    },
  });
  scheduleJob(() => runClipJob(item.id, userId, opts), {
    kind: "clip",
    pool: "video",
    userId,
    refType: "galleryItem",
    refId: item.id,
    title: item.title || undefined,
  });
  return item;
}

export async function enqueueFilmJob(userId: string, opts: FilmPayload) {
  const n = Math.min(Math.max(opts.sceneCount ?? 2, 2), 4);
  const item = await createPendingItem({
    userId,
    kind: "film",
    title: opts.title || `Mini-film ${n} scenes`,
    prompt: opts.plot,
    characterId: opts.characterId || null,
    meta: {
      jobAction: "film",
      sceneCount: n,
      withMusic: !!opts.withMusic,
      durationSec: opts.durationSec,
    },
  });
  scheduleJob(() => runFilmJob(item.id, userId, opts), {
    kind: "film",
    pool: "video",
    userId,
    refType: "galleryItem",
    refId: item.id,
    title: item.title || undefined,
  });
  return item;
}

export async function enqueueRegenJob(userId: string, srcId: string) {
  const src = await prisma.galleryItem.findFirst({
    where: { id: srcId, userId },
  });
  if (!src) throw new Error("not found");
  const meta = JSON.parse(src.metaJson || "{}") as {
    poseId?: string;
    styleId?: string;
    characterIds?: string[];
    usePreset?: boolean;
    presetId?: string | null;
    userNote?: string;
    includeMale?: boolean;
    clothed?: boolean;
    pokies?: boolean;
    skinDetail?: boolean;
    skinDetailStrength?: number;
    legoQuery?: string;
    orientationId?: string;
    photoTemplateId?: string | null;
    useIdentityDualRef?: boolean;
  };
  const characterIds =
    meta.characterIds?.length
      ? meta.characterIds
      : src.characterId
        ? [src.characterId]
        : [];
  const composed = src.prompt?.trim();
  return enqueuePhotoJob(userId, {
    userId,
    characterId: characterIds[0] || src.characterId,
    characterIds,
    title: `${src.title || "Photo"} (regen)`,
    poseId: meta.poseId,
    styleId: meta.styleId,
    userNote: meta.userNote || meta.legoQuery || undefined,
    legoQuery: meta.legoQuery || meta.userNote || undefined,
    orientationId: meta.orientationId,
    photoTemplateId: meta.photoTemplateId || undefined,
    useIdentityDualRef: meta.useIdentityDualRef || !!meta.photoTemplateId,
    includeMale: meta.includeMale,
    clothed: meta.clothed,
    pokies: meta.pokies,
    skinDetail: meta.skinDetail,
    skinDetailStrength: meta.skinDetailStrength,
    usePreset: meta.usePreset,
    presetId: meta.presetId,
    width: src.width ?? undefined,
    height: src.height ?? undefined,
    // Same prompt, new noise — otherwise regen looks identical / ignores the shot.
    composedPrompt: composed || undefined,
    seed: Math.floor(Math.random() * 1e15),
  });
}

export async function enqueueEditJob(userId: string, srcId: string, editPrompt: string) {
  const src = await prisma.galleryItem.findFirst({
    where: { id: srcId, userId },
  });
  if (!src) throw new Error("not found");
  const meta = JSON.parse(src.metaJson || "{}") as {
    poseId?: string;
    styleId?: string;
    characterIds?: string[];
    usePreset?: boolean;
    presetId?: string | null;
    userNote?: string;
    includeMale?: boolean;
    clothed?: boolean;
    pokies?: boolean;
  };
  const characterIds =
    meta.characterIds?.length
      ? meta.characterIds
      : src.characterId
        ? [src.characterId]
        : [];
  return enqueuePhotoJob(userId, {
    userId,
    characterId: characterIds[0] || src.characterId,
    characterIds,
    title: `${src.title || "Photo"} (edit)`,
    poseId: meta.poseId,
    styleId: meta.styleId,
    userNote: meta.userNote,
    includeMale: meta.includeMale,
    clothed: meta.clothed,
    pokies: meta.pokies,
    usePreset: meta.usePreset,
    presetId: meta.presetId,
    width: src.width ?? undefined,
    height: src.height ?? undefined,
    editOfId: src.id,
    editPrompt,
  });
}

export async function enqueueAnimateJob(
  userId: string,
  stillId: string,
  plot: string,
  withMusic?: boolean,
  composedPrompt?: string,
  durationSec?: number,
  attach?: {
    templatePackId?: string;
    templateFrameId?: string;
    poseId?: string | null;
    templateRunFrameId?: string;
    dialogue?: string;
  },
) {
  const still = await prisma.galleryItem.findFirst({
    where: { id: stillId, userId, kind: "photo" },
  });
  if (!still) throw new Error("still not found");
  if (!still.resultUrl?.trim() || still.resultUrl === GALLERY_PLACEHOLDER_URL) {
    throw new Error("У still нет файла результата");
  }
  const stillBytes = localBytesFromResultUrl(still.resultUrl);
  if (!stillBytes?.length) {
    throw new Error(
      "Файл still не найден на диске — перегенерируй фото в этой сессии",
    );
  }
  return enqueueClipJob(userId, {
    userId,
    characterId: still.characterId,
    plot,
    stillId: still.id,
    withMusic,
    composedPrompt,
    durationSec,
    poseId: attach?.poseId || undefined,
    dialogue: attach?.dialogue,
    templatePackId: attach?.templatePackId,
    templateFrameId: attach?.templateFrameId,
    templateRunFrameId: attach?.templateRunFrameId,
    title: `Animate: ${still.title || "photo"}`,
  });
}

export async function enqueueTemplateStitchJob(
  userId: string,
  packId: string,
  clipResultUrls: string[],
  opts?: { withMusic?: boolean; musicNote?: string },
) {
  if (clipResultUrls.length < 2) {
    throw new Error("Нужно минимум два готовых ролика");
  }
  const pack = await prisma.templatePack.findFirst({
    where: { id: packId, userId },
  });
  if (!pack) throw new Error("not found");
  const item = await createPendingItem({
    userId,
    kind: "film",
    title: `Склейка · ${pack.title}`,
    prompt: pack.idea || pack.title,
    meta: {
      jobAction: "template_stitch",
      templatePackId: packId,
      withMusic: !!opts?.withMusic,
    },
  });
  try {
    await prisma.templatePack.update({
      where: { id: packId },
      data: { stitchItemId: item.id, updatedAt: new Date() },
    });
  } catch (e) {
    console.warn(
      "[peach] stitchItemId update skipped (restart Next + prisma generate):",
      e instanceof Error ? e.message.slice(0, 120) : e,
    );
  }
  scheduleJob(
    async () => {
      try {
        const { stitchFilmClips } = await import("@/lib/peach-lab-film");
        const stitched = await stitchFilmClips({
          userId,
          projectId: packId,
          clipResultUrls,
          withMusic: !!opts?.withMusic,
          musicNote: opts?.musicNote,
        });
        await markReady(item.id, userId, {
          resultUrl: stitched.publicUrl,
          width: stitched.width,
          height: stitched.height,
          title: `Склейка · ${pack.title}`,
          meta: {
            localKey: stitched.relKey,
            engine: stitched.engine,
            templatePackId: packId,
            jobAction: "template_stitch",
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ошибка склейки";
        console.error("[peach] template stitch failed:", e);
        await markError(item.id, userId, msg, {
          jobAction: "template_stitch",
          templatePackId: packId,
        });
      }
    },
    {
      kind: "film",
      pool: "video",
      userId,
      refType: "galleryItem",
      refId: item.id,
      title: item.title || undefined,
    },
  );
  return item;
}
