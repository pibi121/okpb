/**
 * TG-style photo templates (PhotoTemplate table) — face ref + scene preview, no LoRA.
 */
import { prisma } from "@/lib/db";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { saveGalleryBinary } from "@/lib/local-store";
import type { TgPhotoTier } from "@/lib/tg-pricing";
import { guessPhotoSceneCategory } from "@/lib/tg/feed-order";
import {
  emptyPhotoAnimateConfig,
  parsePhotoAnimateConfig,
  serializePhotoAnimateConfig,
  type PhotoAnimateConfig,
} from "@/lib/photo-template-animate";

export type TgPhotoTemplateRow = {
  id: string;
  title: string;
  notes: string;
  tier: TgPhotoTier;
  editPrompt: string;
  previewImageUrl: string;
  sceneImageUrl: string;
  previewVideoUrl: string;
  animate: PhotoAnimateConfig;
  published: boolean;
  sortOrder: number;
  tgPublished: boolean;
  tgDisplayTitle: string;
  sceneCategory: string;
};

const usablePhotoWhere = {
  OR: [{ published: true }, { tgPublished: true }],
};

function mapRow(r: {
  id: string;
  title: string;
  notes: string;
  tier: string;
  editPrompt: string;
  previewImageUrl: string;
  sceneImageUrl: string;
  previewVideoUrl?: string | null;
  animateJson?: string | null;
  published: boolean;
  sortOrder: number;
  tgPublished: boolean;
  tgDisplayTitle: string;
  sceneCategory: string | null;
}): TgPhotoTemplateRow {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    tier: (r.tier === "pose" ? "pose" : "basic") as TgPhotoTier,
    editPrompt: r.editPrompt,
    previewImageUrl: r.previewImageUrl || r.sceneImageUrl,
    sceneImageUrl: r.sceneImageUrl || r.previewImageUrl,
    previewVideoUrl: r.previewVideoUrl || "",
    animate: parsePhotoAnimateConfig(r.animateJson),
    published: r.published,
    sortOrder: r.sortOrder,
    tgPublished: r.tgPublished,
    tgDisplayTitle: r.tgDisplayTitle,
    sceneCategory: r.sceneCategory || "",
  };
}

export async function listTgPhotoTemplatesForLab(): Promise<TgPhotoTemplateRow[]> {
  const rows = await prisma.photoTemplate.findMany({
    where: usablePhotoWhere,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(mapRow);
}

export async function listAllPhotoTemplatesForLab(): Promise<TgPhotoTemplateRow[]> {
  const rows = await prisma.photoTemplate.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(mapRow);
}

export async function getTgPhotoTemplateForGeneration(
  templateId: string,
): Promise<TgPhotoTemplateRow | null> {
  const row = await prisma.photoTemplate.findFirst({
    where: { id: templateId, ...usablePhotoWhere },
  });
  if (!row) return null;
  return mapRow(row);
}

export async function getPhotoTemplateById(
  templateId: string,
): Promise<TgPhotoTemplateRow | null> {
  const row = await prisma.photoTemplate.findUnique({ where: { id: templateId } });
  if (!row) return null;
  return mapRow(row);
}

export async function resolveTgPhotoTemplateSceneBuffer(
  templateId: string,
): Promise<Buffer | null> {
  const tpl = await getPhotoTemplateById(templateId);
  if (!tpl) return null;
  const url = tpl.sceneImageUrl || tpl.previewImageUrl;
  if (!url) return null;
  return localBytesFromResultUrl(url) || null;
}

export async function createTgPhotoTemplateFromUpload(opts: {
  userId: string;
  title: string;
  editPrompt: string;
  notes?: string;
  tgDisplayTitle?: string;
  tier?: TgPhotoTier;
  sceneBytes: Buffer;
  sceneExt?: string;
  previewVideoBytes?: Buffer;
  previewVideoExt?: string;
  animate?: PhotoAnimateConfig;
  sceneCategory?: string;
}) {
  const saved = saveGalleryBinary(
    opts.userId,
    opts.sceneExt || "png",
    opts.sceneBytes,
    "tg_photo_tpl",
  );
  let previewVideoUrl = "";
  if (opts.previewVideoBytes?.length) {
    const vid = saveGalleryBinary(
      opts.userId,
      opts.previewVideoExt || "mp4",
      opts.previewVideoBytes,
      "tg_photo_tpl_teaser",
    );
    previewVideoUrl = vid.publicUrl;
  }
  const { sanitizeTemplateScenePrompt } = await import("@/lib/template-scene");
  const editPrompt = sanitizeTemplateScenePrompt(opts.editPrompt.trim(), {
    fallback: opts.editPrompt.trim(),
  });
  const animate = opts.animate || emptyPhotoAnimateConfig();
  const row = await prisma.photoTemplate.create({
    data: {
      title: opts.title.trim().slice(0, 120) || "Photo template",
      notes: (opts.notes || "").trim().slice(0, 2000),
      tier: opts.tier === "pose" ? "pose" : "basic",
      editPrompt,
      sceneImageUrl: saved.publicUrl,
      previewImageUrl: saved.publicUrl,
      previewVideoUrl,
      animateJson: serializePhotoAnimateConfig(animate),
      published: true,
      tgPublished: false,
      tgDisplayTitle: (opts.tgDisplayTitle || opts.title || "").trim().slice(0, 80),
      sceneCategory:
        (opts.sceneCategory || "").trim() ||
        guessPhotoSceneCategory(opts.title),
    },
  });
  return getPhotoTemplateById(row.id);
}

export async function updatePhotoTemplateLabMeta(opts: {
  templateId: string;
  title?: string;
  notes?: string;
  tgDisplayTitle?: string;
  tgPublished?: boolean;
  sceneCategory?: string;
  animate?: PhotoAnimateConfig;
  previewVideoBytes?: Buffer;
  previewVideoExt?: string;
  userId: string;
}) {
  const existing = await prisma.photoTemplate.findUnique({
    where: { id: opts.templateId },
  });
  if (!existing) throw new Error("Шаблон не найден");

  let previewVideoUrl = existing.previewVideoUrl || "";
  if (opts.previewVideoBytes?.length) {
    const vid = saveGalleryBinary(
      opts.userId,
      opts.previewVideoExt || "mp4",
      opts.previewVideoBytes,
      "tg_photo_tpl_teaser",
    );
    previewVideoUrl = vid.publicUrl;
  }

  const data: Record<string, unknown> = {};
  if (opts.title !== undefined) data.title = opts.title.trim().slice(0, 120);
  if (opts.notes !== undefined) data.notes = opts.notes.trim().slice(0, 2000);
  if (opts.tgDisplayTitle !== undefined) {
    data.tgDisplayTitle = opts.tgDisplayTitle.trim().slice(0, 80);
  }
  if (opts.tgPublished !== undefined) data.tgPublished = opts.tgPublished;
  if (opts.sceneCategory !== undefined) {
    data.sceneCategory = opts.sceneCategory.trim().slice(0, 120);
  }
  if (opts.animate) data.animateJson = serializePhotoAnimateConfig(opts.animate);
  if (opts.previewVideoBytes?.length) data.previewVideoUrl = previewVideoUrl;

  await prisma.photoTemplate.update({
    where: { id: opts.templateId },
    data,
  });
  return getPhotoTemplateById(opts.templateId);
}
