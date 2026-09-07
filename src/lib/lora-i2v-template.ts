/**
 * LoRA still (Krea) → Minimax I2V template recipes.
 */
import { prisma } from "@/lib/db";
import { copyAssetToTgCatalog } from "@/lib/tg/tg-publish";
import { ensureTgCatalog } from "@/lib/tg/tg-catalog";
import { formatPhotoSceneCategories } from "@/lib/tg/feed-order";
import { premiumVideoPeaches } from "@/lib/tg-pricing";

export type LoraI2vTemplateRow = {
  id: string;
  title: string;
  notes: string;
  titleEn: string;
  notesEn: string;
  stillPrompt: string;
  negativePrompt: string;
  i2vPrompt: string;
  orientation: string;
  durationSec: number;
  pricePeaches: number;
  published: boolean;
  tgPublished: boolean;
  tgDisplayTitle: string;
  tgSortOrder: number;
  sceneCategory: string;
  previewImageUrl: string;
  previewVideoUrl: string;
  sourceStillId: string;
  sourceVideoId: string;
  previewIdentityKey: string;
  requiresLora: boolean;
  createdAt: string;
  updatedAt: string;
};

function mapRow(r: {
  id: string;
  title: string;
  notes: string;
  titleEn: string;
  notesEn: string;
  stillPrompt: string;
  negativePrompt: string;
  i2vPrompt: string;
  orientation: string;
  durationSec: number;
  pricePeaches: number;
  published: boolean;
  tgPublished: boolean;
  tgDisplayTitle: string;
  tgSortOrder: number;
  sceneCategory: string;
  previewImageUrl: string;
  previewVideoUrl: string;
  sourceStillId: string;
  sourceVideoId: string;
  previewIdentityKey: string;
  requiresLora: boolean;
  createdAt: Date;
  updatedAt: Date;
}): LoraI2vTemplateRow {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    titleEn: r.titleEn,
    notesEn: r.notesEn,
    stillPrompt: r.stillPrompt,
    negativePrompt: r.negativePrompt,
    i2vPrompt: r.i2vPrompt,
    orientation: r.orientation,
    durationSec: r.durationSec,
    pricePeaches: r.pricePeaches,
    published: r.published,
    tgPublished: r.tgPublished,
    tgDisplayTitle: r.tgDisplayTitle,
    tgSortOrder: r.tgSortOrder,
    sceneCategory: r.sceneCategory,
    previewImageUrl: r.previewImageUrl,
    previewVideoUrl: r.previewVideoUrl,
    sourceStillId: r.sourceStillId,
    sourceVideoId: r.sourceVideoId,
    previewIdentityKey: r.previewIdentityKey,
    requiresLora: r.requiresLora,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Strip author LoRA trigger / name crumbs from recipe prompts. */
export function scrubAuthorIdentityFromPrompt(
  prompt: string,
  opts?: { triggerWord?: string | null; characterName?: string | null },
): string {
  let s = prompt.trim();
  if (!s) return "";
  const trigger = opts?.triggerWord?.trim();
  if (trigger) {
    const re = new RegExp(
      `\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    s = s.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  const name = opts?.characterName?.trim();
  if (name && name.length >= 2) {
    const re = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    s = s.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  return s.replace(/^[,;\s]+|[,;\s]+$/g, "").trim();
}

export async function listLoraI2vTemplatesForLab(
  userId: string,
): Promise<LoraI2vTemplateRow[]> {
  const rows = await prisma.loraI2vTemplate.findMany({
    where: { userId },
    orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(mapRow);
}

export async function listTgPublishedLoraI2vTemplates(locale: "ru" | "en" = "ru") {
  const rows = await prisma.loraI2vTemplate.findMany({
    where: { tgPublished: true },
    orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
  });
  const { tgPhotoPeaches } = await import("@/lib/tg-pricing");
  void tgPhotoPeaches;
  return rows.map((r) => {
    const title =
      locale === "en" && r.titleEn.trim()
        ? r.titleEn
        : r.tgDisplayTitle.trim() || r.title;
    const notes =
      locale === "en" && r.notesEn.trim() ? r.notesEn : r.notes;
    return {
      id: r.id,
      title,
      notes,
      pricePeaches: r.pricePeaches || premiumVideoPeaches(r.durationSec || 6),
      previewImageUrl: r.previewImageUrl,
      previewVideoUrl: r.previewVideoUrl,
      durationSec: r.durationSec,
      orientation: r.orientation,
      sceneCategory: r.sceneCategory || "",
      requiresLora: r.requiresLora,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      identityKey: r.previewIdentityKey || r.userId || r.id,
      kind: "lora_i2v" as const,
    };
  });
}

export async function getLoraI2vTemplate(
  userId: string,
  id: string,
): Promise<LoraI2vTemplateRow | null> {
  const row = await prisma.loraI2vTemplate.findFirst({
    where: { id, userId },
  });
  return row ? mapRow(row) : null;
}

export async function createLoraI2vTemplate(opts: {
  userId: string;
  title: string;
  notes?: string;
  stillPrompt: string;
  i2vPrompt: string;
  negativePrompt?: string;
  orientation?: string;
  durationSec?: number;
  pricePeaches?: number;
  sceneCategory?: string | string[];
  previewImageUrl?: string;
  previewVideoUrl?: string;
  sourceStillId?: string;
  sourceVideoId?: string;
  previewIdentityKey?: string;
  scrub?: { triggerWord?: string | null; characterName?: string | null };
}) {
  const title = opts.title.trim().slice(0, 120);
  if (!title) throw new Error("Укажи название");
  const stillPrompt = scrubAuthorIdentityFromPrompt(
    opts.stillPrompt,
    opts.scrub,
  );
  const i2vPrompt = scrubAuthorIdentityFromPrompt(opts.i2vPrompt, opts.scrub);
  if (!stillPrompt) throw new Error("Нужен still-промпт (Krea)");
  if (!i2vPrompt) throw new Error("Нужен I2V-промпт (движение)");

  const sceneCategory = Array.isArray(opts.sceneCategory)
    ? formatPhotoSceneCategories(opts.sceneCategory)
    : formatPhotoSceneCategories(
        String(opts.sceneCategory || "")
          .split(/[,|;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );

  const row = await prisma.loraI2vTemplate.create({
    data: {
      userId: opts.userId,
      title,
      notes: (opts.notes || "").trim().slice(0, 500),
      stillPrompt,
      i2vPrompt,
      negativePrompt: (opts.negativePrompt || "").trim().slice(0, 2000),
      orientation: opts.orientation || "9_16",
      durationSec: Math.min(12, Math.max(4, opts.durationSec || 6)),
      pricePeaches: Math.max(
        0,
        opts.pricePeaches ?? premiumVideoPeaches(opts.durationSec || 6),
      ),
      sceneCategory,
      previewImageUrl: opts.previewImageUrl || "",
      previewVideoUrl: opts.previewVideoUrl || "",
      sourceStillId: opts.sourceStillId || "",
      sourceVideoId: opts.sourceVideoId || "",
      previewIdentityKey: opts.previewIdentityKey || opts.userId,
      published: false,
      requiresLora: true,
    },
  });
  return mapRow(row);
}

export async function updateLoraI2vTemplate(
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    notes: string;
    titleEn: string;
    notesEn: string;
    stillPrompt: string;
    i2vPrompt: string;
    negativePrompt: string;
    orientation: string;
    durationSec: number;
    pricePeaches: number;
    sceneCategory: string;
    previewImageUrl: string;
    previewVideoUrl: string;
    sourceStillId: string;
    sourceVideoId: string;
    published: boolean;
    scrub: { triggerWord?: string | null; characterName?: string | null };
  }>,
) {
  const existing = await prisma.loraI2vTemplate.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error("Шаблон не найден");

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title.trim().slice(0, 120);
  if (patch.notes !== undefined) data.notes = patch.notes.trim().slice(0, 500);
  if (patch.titleEn !== undefined) data.titleEn = patch.titleEn.trim().slice(0, 120);
  if (patch.notesEn !== undefined) data.notesEn = patch.notesEn.trim().slice(0, 500);
  if (patch.stillPrompt !== undefined) {
    data.stillPrompt = scrubAuthorIdentityFromPrompt(
      patch.stillPrompt,
      patch.scrub,
    );
  }
  if (patch.i2vPrompt !== undefined) {
    data.i2vPrompt = scrubAuthorIdentityFromPrompt(patch.i2vPrompt, patch.scrub);
  }
  if (patch.negativePrompt !== undefined) {
    data.negativePrompt = patch.negativePrompt.trim().slice(0, 2000);
  }
  if (patch.orientation !== undefined) data.orientation = patch.orientation;
  if (patch.durationSec !== undefined) {
    data.durationSec = Math.min(12, Math.max(4, patch.durationSec));
  }
  if (patch.pricePeaches !== undefined) {
    data.pricePeaches = Math.max(0, patch.pricePeaches);
  }
  if (patch.sceneCategory !== undefined) {
    data.sceneCategory = formatPhotoSceneCategories(
      patch.sceneCategory.split(/[,|;]+/).map((s) => s.trim()).filter(Boolean),
    );
  }
  if (patch.previewImageUrl !== undefined) {
    data.previewImageUrl = patch.previewImageUrl;
  }
  if (patch.previewVideoUrl !== undefined) {
    data.previewVideoUrl = patch.previewVideoUrl;
  }
  if (patch.sourceStillId !== undefined) data.sourceStillId = patch.sourceStillId;
  if (patch.sourceVideoId !== undefined) data.sourceVideoId = patch.sourceVideoId;
  if (patch.published !== undefined) data.published = patch.published;

  const row = await prisma.loraI2vTemplate.update({ where: { id }, data });
  return mapRow(row);
}

export async function deleteLoraI2vTemplate(userId: string, id: string) {
  const existing = await prisma.loraI2vTemplate.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error("Шаблон не найден");
  await prisma.loraI2vTemplate.delete({ where: { id } });
}

export async function publishLoraI2vTemplateToTg(
  templateId: string,
  opts?: { displayTitle?: string; sceneCategory?: string },
) {
  const row = await prisma.loraI2vTemplate.findUnique({
    where: { id: templateId },
  });
  if (!row) throw new Error("Шаблон не найден");
  if (!row.stillPrompt.trim() || !row.i2vPrompt.trim()) {
    throw new Error("Сначала сохрани still + I2V промпты");
  }
  if (!row.previewVideoUrl.trim()) {
    throw new Error("Нужен preview-видео (оживи still) перед переносом в TG");
  }
  if (!row.previewImageUrl.trim()) {
    throw new Error("Нужен preview-still перед переносом в TG");
  }

  const slug = `li2v-${templateId.slice(0, 10)}`;
  const previewVideoUrl = row.previewVideoUrl
    ? copyAssetToTgCatalog(row.previewVideoUrl, `${slug}-preview`, ".mp4")
    : "";
  const previewImageUrl = row.previewImageUrl
    ? copyAssetToTgCatalog(row.previewImageUrl, `${slug}-thumb`, ".jpg")
    : "";

  const updated = await prisma.loraI2vTemplate.update({
    where: { id: templateId },
    data: {
      tgPublished: true,
      tgDisplayTitle:
        opts?.displayTitle?.trim() ?? row.tgDisplayTitle,
      previewVideoUrl: previewVideoUrl || row.previewVideoUrl,
      previewImageUrl: previewImageUrl || row.previewImageUrl,
      ...(opts?.sceneCategory !== undefined
        ? { sceneCategory: opts.sceneCategory }
        : {}),
    },
  });
  await ensureTgCatalog();
  return mapRow(updated);
}

export async function unpublishLoraI2vTemplateFromTg(templateId: string) {
  const updated = await prisma.loraI2vTemplate.update({
    where: { id: templateId },
    data: { tgPublished: false },
  });
  return mapRow(updated);
}

export async function updateLoraI2vTemplateTgMeta(
  templateId: string,
  patch: {
    displayTitle?: string;
    sortOrder?: number;
    sceneCategory?: string;
  },
) {
  const data: {
    tgDisplayTitle?: string;
    tgSortOrder?: number;
    sceneCategory?: string;
  } = {};
  if (patch.displayTitle !== undefined) {
    data.tgDisplayTitle = patch.displayTitle.trim();
  }
  if (patch.sortOrder !== undefined) data.tgSortOrder = patch.sortOrder;
  if (patch.sceneCategory !== undefined) {
    data.sceneCategory = patch.sceneCategory;
  }
  const updated = await prisma.loraI2vTemplate.update({
    where: { id: templateId },
    data,
  });
  return mapRow(updated);
}
