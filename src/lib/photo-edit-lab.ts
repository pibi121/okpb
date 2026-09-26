/**
 * Peach lab: single-photo Krea Identity Edit
 * (Projector + Realism + optional concept LoRAs) — same stack as TG undress.
 */
import { prisma } from "@/lib/db";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { saveGalleryBinary } from "@/lib/local-store";
import {
  buildKreaEditGraph,
  KREA_UNDRESS_EXTRA_LORAS,
} from "@/lib/krea-graphs";
import { resolveConceptLorasByIds } from "@/lib/krea-concept-loras";
import {
  comfyFreeMemory,
  comfyUploadImage,
  runComfyAndDownload,
  COMFY_PHOTO_TIMEOUT_MS,
} from "@/lib/comfy-client";
import {
  undressImageSize,
  undressLatentSize,
} from "@/lib/tg/undress-comfy";
import { createTgPhotoTemplateFromUpload } from "@/lib/tg-photo-template-lab";
import { localBytesFromResultUrl } from "@/lib/peach-lab";

export async function runPhotoEditLabBytes(opts: {
  photoBytes: Buffer;
  editPrompt: string;
  /** Concept LoRA ids from presets/krea_concept_loras.json */
  conceptLoraIds?: string[];
  /** Keep Projector+Realism undress stack (default true). */
  useUndressStack?: boolean;
}): Promise<Buffer> {
  const prompt = opts.editPrompt.trim();
  if (prompt.length < 2) throw new Error("Нужен промпт");

  const isJpeg =
    opts.photoBytes.length >= 3 &&
    opts.photoBytes[0] === 0xff &&
    opts.photoBytes[1] === 0xd8;
  const isPng =
    opts.photoBytes.length >= 8 &&
    opts.photoBytes[0] === 0x89 &&
    opts.photoBytes[1] === 0x50;
  const ext = isJpeg ? "jpg" : isPng ? "png" : "jpg";
  const mime = isJpeg ? "image/jpeg" : isPng ? "image/png" : "image/jpeg";

  const uploaded = await comfyUploadImage(
    `photo_edit_lab_${Date.now()}.${ext}`,
    opts.photoBytes,
    mime,
  );
  const raw = undressImageSize(opts.photoBytes);
  const { width, height } = undressLatentSize(raw.width, raw.height);

  const extras = [
    ...(opts.useUndressStack === false ? [] : KREA_UNDRESS_EXTRA_LORAS),
    ...resolveConceptLorasByIds(opts.conceptLoraIds || []),
  ];

  const graph = buildKreaEditGraph({
    imageName: uploaded,
    editPrompt: prompt,
    width,
    height,
    seed: Math.floor(Math.random() * 1e15),
    extraModelLoras: extras,
    filenamePrefix: "peach/photo_edit_lab",
  });

  await comfyFreeMemory();
  const bytes = await runComfyAndDownload(
    graph,
    "peach-photo-edit-lab",
    COMFY_PHOTO_TIMEOUT_MS,
  );
  if (!bytes?.length || bytes.length < 100) {
    throw new Error("Comfy вернул пустой файл");
  }
  return bytes;
}

export async function enqueuePhotoEditLabJob(opts: {
  userId: string;
  photoBytes: Buffer;
  editPrompt: string;
  conceptLoraIds?: string[];
  useUndressStack?: boolean;
  title?: string;
}): Promise<{ galleryItemId: string }> {
  const promptText = opts.editPrompt.trim().slice(0, 2000);
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "photo",
      title: (opts.title || "Photo edit lab").slice(0, 120),
      prompt: promptText,
      editPrompt: promptText,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        engine: "krea2_photo_edit_lab",
        conceptLoraIds: opts.conceptLoraIds || [],
        useUndressStack: opts.useUndressStack !== false,
        source: "peach_photo_edit_lab",
        jobAction: "photo_edit_lab",
        legoQuery: promptText,
        editPrompt: promptText,
      }),
    },
  });

  const galleryItemId = item.id;
  const photoBytes = opts.photoBytes;
  const editPrompt = opts.editPrompt;
  const conceptLoraIds = opts.conceptLoraIds || [];
  const useUndressStack = opts.useUndressStack !== false;

  void enqueueGpuJob(
    async () => {
      try {
        const bytes = await runPhotoEditLabBytes({
          photoBytes,
          editPrompt,
          conceptLoraIds,
          useUndressStack,
        });
        const saved = saveGalleryBinary(
          opts.userId,
          "png",
          bytes,
          `photo_edit_lab_${galleryItemId}`,
        );
        await prisma.galleryItem.update({
          where: { id: galleryItemId },
          data: {
            resultUrl: saved.publicUrl,
            metaJson: JSON.stringify({
              status: "ready",
              engine: "krea2_photo_edit_lab",
              conceptLoraIds,
              useUndressStack,
              source: "peach_photo_edit_lab",
              jobAction: "photo_edit_lab",
              legoQuery: editPrompt.trim(),
              editPrompt: editPrompt.trim(),
            }),
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[photo-edit-lab]", msg);
        await prisma.galleryItem.update({
          where: { id: galleryItemId },
          data: {
            metaJson: JSON.stringify({
              status: "error",
              engine: "krea2_photo_edit_lab",
              error: msg.slice(0, 500),
              source: "peach_photo_edit_lab",
            }),
          },
        });
      }
    },
    {
      userId: opts.userId,
      kind: "photo_edit_lab",
      title: "photo-edit-lab",
      refType: "galleryItem",
      refId: galleryItemId,
      pool: "photo",
      providers: ["metalnode"],
      meta: { photoEditLab: true },
    },
  );

  return { galleryItemId };
}

/** Save lab result as TG PhotoTemplate (for catalog publish). */
export async function savePhotoEditLabAsTgTemplate(opts: {
  userId: string;
  galleryItemId: string;
  title: string;
  notes?: string;
  tgDisplayTitle?: string;
  editPrompt?: string;
  previewVideoBytes?: Buffer;
  previewVideoExt?: string;
  animate?: import("@/lib/photo-template-animate").PhotoAnimateConfig;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId, kind: "photo" },
  });
  if (!item) throw new Error("Кадр не найден");
  const bytes = localBytesFromResultUrl(item.resultUrl);
  if (!bytes?.length) throw new Error("Файл кадра ещё не готов");

  let meta: { editPrompt?: string; legoQuery?: string; status?: string } = {};
  try {
    meta = JSON.parse(item.metaJson || "{}") as typeof meta;
  } catch {
    /* ignore */
  }
  if (meta.status === "pending") throw new Error("Кадр ещё генерируется");
  if (meta.status === "error") throw new Error("Нельзя сохранить ошибочный кадр");

  const editPrompt =
    opts.editPrompt?.trim() ||
    meta.editPrompt?.trim() ||
    meta.legoQuery?.trim() ||
    item.prompt?.trim() ||
    "";
  if (editPrompt.length < 2) throw new Error("Нет edit-промпта для шаблона");

  const ext = item.resultUrl.split(".").pop()?.split("?")[0] || "png";
  return createTgPhotoTemplateFromUpload({
    userId: opts.userId,
    title: opts.title,
    editPrompt,
    notes: opts.notes,
    tgDisplayTitle: opts.tgDisplayTitle || opts.title,
    tier: "pose",
    sceneBytes: bytes,
    sceneExt: ext,
    previewVideoBytes: opts.previewVideoBytes,
    previewVideoExt: opts.previewVideoExt,
    animate: opts.animate,
  });
}
