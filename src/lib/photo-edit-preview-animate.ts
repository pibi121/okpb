import { prisma } from "@/lib/db";
import { enqueueAnimateJob } from "@/lib/gallery-jobs";
import {
  galleryStatus,
  GALLERY_PLACEHOLDER_URL,
} from "@/lib/gallery-meta";
import { saveGalleryBinary } from "@/lib/local-store";
import { resolveTgPhotoTemplateSceneBuffer } from "@/lib/tg-photo-template-lab";
import { clampDurationSec } from "@/lib/video-graphs";
import {
  ANIMATE_DURATIONS_SEC,
  type AnimateDurationSec,
} from "@/lib/photo-template-animate";

export function isAnimatePreviewDuration(
  n: number,
): n is AnimateDurationSec {
  return (ANIMATE_DURATIONS_SEC as readonly number[]).includes(n);
}

/**
 * Resolve a ready user gallery still for I2V preview.
 * Lab create: stillItemId from photo-edit generate.
 * Lab edit: materialize PhotoTemplate scene into a one-off gallery still.
 */
export async function resolveStillForAnimatePreview(opts: {
  userId: string;
  stillItemId?: string;
  templateId?: string;
}): Promise<{ stillItemId: string }> {
  const stillItemId = opts.stillItemId?.trim();
  if (stillItemId) {
    const still = await prisma.galleryItem.findFirst({
      where: { id: stillItemId, userId: opts.userId, kind: "photo" },
    });
    if (!still) throw new Error("Кадр не найден");
    const st = galleryStatus(still.metaJson);
    if (st === "pending") throw new Error("Кадр ещё генерируется");
    if (st === "error") throw new Error("Кадр в ошибке — перегенерируй");
    if (
      !still.resultUrl?.trim() ||
      still.resultUrl === GALLERY_PLACEHOLDER_URL
    ) {
      throw new Error("У кадра нет файла результата");
    }
    return { stillItemId: still.id };
  }

  const templateId = opts.templateId?.trim();
  if (!templateId) {
    throw new Error("Нужен galleryItemId или templateId");
  }

  const bytes = await resolveTgPhotoTemplateSceneBuffer(templateId);
  if (!bytes?.length) {
    throw new Error("У шаблона нет кадра для оживления");
  }

  const saved = saveGalleryBinary(
    opts.userId,
    "png",
    bytes,
    "photo_edit_animate_still",
  );
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "photo",
      title: "Animate preview still",
      prompt: "photo-edit · animate preview",
      resultUrl: saved.publicUrl,
      metaJson: JSON.stringify({
        status: "ready",
        jobAction: "photo_edit_animate_still",
        sourceTemplateId: templateId,
      }),
    },
  });
  return { stillItemId: item.id };
}

export async function enqueuePhotoEditAnimatePreview(opts: {
  userId: string;
  stillItemId?: string;
  templateId?: string;
  i2vPrompt: string;
  durationSec: number;
}) {
  const prompt = opts.i2vPrompt.trim();
  if (prompt.length < 2) throw new Error("Нужен промпт оживления");

  const requested = Math.round(opts.durationSec);
  if (!isAnimatePreviewDuration(requested)) {
    throw new Error("Длительность: 3, 7 или 12 сек");
  }
  // MiniMax H3 I2V: engine clamp 4–12 (3 → 4).
  const durationSec = clampDurationSec(requested);

  const { stillItemId } = await resolveStillForAnimatePreview({
    userId: opts.userId,
    stillItemId: opts.stillItemId,
    templateId: opts.templateId,
  });

  const item = await enqueueAnimateJob(
    opts.userId,
    stillItemId,
    prompt,
    false,
    prompt,
    durationSec,
  );

  return {
    item,
    stillItemId,
    requestedDurationSec: requested,
    engineDurationSec: durationSec,
  };
}
