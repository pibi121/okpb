/**
 * Transfer gallery items to Peach templates and/or TG catalog.
 */
import { prisma } from "@/lib/db";
import { parseGalleryMeta } from "@/lib/gallery-meta";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { createQuickVideoTemplateFromRun } from "@/lib/quick-video-template";
import { enrichGalleryVideosWithRunIds } from "@/lib/gallery-video-enrich";
import {
  publishPhotoTemplateToTg,
  publishQuickVideoTemplateToTg,
} from "@/lib/tg/tg-publish";
import { saveGalleryBinary } from "@/lib/local-store";
import { sanitizeTemplateScenePrompt } from "@/lib/template-scene";
import { guessPhotoSceneCategory } from "@/lib/tg/feed-order";

export type GalleryTransferMode = "both" | "tg";

async function authorIdentityHints(userId: string, characterId: string | null) {
  if (!characterId) return { names: [] as string[], triggers: [] as string[] };
  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId },
    select: { name: true, triggerWord: true },
  });
  return {
    names: ch?.name ? [ch.name] : [],
    triggers: ch?.triggerWord ? [ch.triggerWord] : [],
  };
}

export async function transferGalleryItem(opts: {
  userId: string;
  galleryItemId: string;
  mode: GalleryTransferMode;
  title?: string;
  displayTitle?: string;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId },
  });
  if (!item) {
    throw new Error("Кадр не найден");
  }
  const meta = parseGalleryMeta(item.metaJson);
  if (meta.status === "pending") {
    throw new Error("Кадр ещё генерируется");
  }
  if (meta.status === "error") throw new Error("Нельзя перенести кадр с ошибкой");

  const title =
    opts.title?.trim() ||
    item.title?.trim() ||
    item.prompt?.trim().slice(0, 80) ||
    (item.kind === "video" ? "Video template" : "Photo template");
  const displayTitle = opts.displayTitle?.trim() || title;
  const peachPublished = opts.mode === "both";

  if (item.kind === "video") {
    const [enriched] = await enrichGalleryVideosWithRunIds(opts.userId, [item]);
    const em = parseGalleryMeta(enriched.metaJson);
    const runId =
      (typeof em.quickVideoRunId === "string" && em.quickVideoRunId) ||
      (
        await prisma.quickVideoRun.findFirst({
          where: { userId: opts.userId, galleryItemId: item.id, status: "ready" },
          select: { id: true },
        })
      )?.id;
    if (!runId) {
      throw new Error("Для видео нужен успешный Quick Video run — сохрани из «Быстрое видео»");
    }
    const tpl = await createQuickVideoTemplateFromRun({
      userId: opts.userId,
      sourceRunId: runId,
      title,
      notes: "",
      category: "peach",
      isJuice: false,
      priceCredits: 0,
      published: peachPublished,
    });
    if (!tpl?.id) {
      throw new Error("Не удалось создать видео-шаблон");
    }
    await publishQuickVideoTemplateToTg(tpl.id, { displayTitle });
    return { kind: "video" as const, templateId: tpl.id, mode: opts.mode };
  }

  if (item.kind === "photo") {
    const bytes = localBytesFromResultUrl(item.resultUrl);
    if (!bytes?.length) throw new Error("Не удалось прочитать файл фото");
    const ext = item.resultUrl.split(".").pop()?.split("?")[0] || "jpg";
    const saved = saveGalleryBinary(opts.userId, ext, bytes, "tg_gallery_tpl");
    const hints = await authorIdentityHints(opts.userId, item.characterId);
    const editPrompt = sanitizeTemplateScenePrompt(
      item.editPrompt?.trim() || item.prompt?.trim() || "",
      {
        authorNames: hints.names,
        authorTriggers: hints.triggers,
        fallback: "cinematic photo, match pose and setting only",
      },
    );
    const row = await prisma.photoTemplate.create({
      data: {
        title,
        notes: "",
        tier: "pose",
        editPrompt,
        sceneImageUrl: saved.publicUrl,
        previewImageUrl: saved.publicUrl,
        published: peachPublished,
        tgPublished: false,
        previewIdentityKey: item.characterId || "",
        sceneCategory: guessPhotoSceneCategory(title),
      },
    });
    await publishPhotoTemplateToTg(row.id, { displayTitle });
    return { kind: "photo" as const, templateId: row.id, mode: opts.mode };
  }

  throw new Error("Поддерживаются только фото и видео");
}
