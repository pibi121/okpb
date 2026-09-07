/**
 * Peach photo-lab templates — save gallery stills as reusable LEGO recipes.
 */
import { prisma } from "@/lib/db";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import {
  parseBlueprint,
  userOwnsTemplate,
  type TemplateCategory,
  type TemplateSlotBlueprint,
} from "@/lib/quick-video-template-shared";
import type { QuickVideoImageSlot, QuickVideoSlotRole } from "@/lib/quick-video-prompt";
import { parseRefSlotsJson, parseRefUrlsJson } from "@/lib/photo-refs-shared";
import type {
  PeachPhotoTemplateDetail,
  PublicPeachPhotoTemplate,
} from "@/lib/peach-photo-template-shared";
import { stripLegoCharacterNames } from "@/lib/prompt-lego";

export type {
  PublicPeachPhotoTemplate,
  PeachPhotoTemplateDetail,
  PeachPhotoTemplateApplyPayload,
} from "@/lib/peach-photo-template-shared";
export type { TemplateCategory } from "@/lib/quick-video-template-shared";

async function authorCharacterNamesForGallery(
  sourceGalleryId: string | null,
): Promise<string[]> {
  if (!sourceGalleryId) return [];
  const item = await prisma.galleryItem.findFirst({
    where: { id: sourceGalleryId },
    select: { characterId: true, metaJson: true },
  });
  if (!item) return [];
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const ids = Array.isArray(meta.characterIds)
    ? (meta.characterIds as string[]).filter(Boolean)
    : item.characterId
      ? [item.characterId]
      : [];
  if (!ids.length) return [];
  const rows = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: { name: true },
  });
  return rows.map((r) => r.name).filter(Boolean);
}

function slotRoleOf(
  slot: QuickVideoImageSlot | undefined,
): QuickVideoSlotRole {
  const r = slot?.role || slot?.kind;
  if (r === "identity" || r === "extra") {
    return r === "identity" ? "identity" : "other";
  }
  return (r || "other") as QuickVideoSlotRole;
}

function buildBlueprintFromGallery(
  refSlots: QuickVideoImageSlot[],
  refImageUrls: string[],
  previewUrl: string,
): TemplateSlotBlueprint[] {
  const blueprint: TemplateSlotBlueprint[] = [];
  for (let i = 0; i < refSlots.length; i++) {
    const slot = refSlots[i]!;
    const role = slotRoleOf(slot);
    const url = refImageUrls[i] || "";
    if (role === "identity") {
      blueprint.push({
        role: "identity",
        label: slot.characterName || slot.label,
      });
      continue;
    }
    blueprint.push({
      role,
      label: slot.label,
      bakedRefUrl: url || undefined,
    });
  }
  if (!blueprint.length) {
    blueprint.push({ role: "identity", label: "Person" });
    if (previewUrl) {
      blueprint.push({
        role: "location",
        label: "Scene",
        bakedRefUrl: previewUrl,
      });
    }
  }
  return blueprint;
}

function toPublic(
  row: {
    id: string;
    userId: string;
    title: string;
    notes: string;
    category: string;
    isJuice: boolean;
    priceCredits: number;
    previewImageUrl: string;
    sceneImageUrl: string;
    orientation: string;
    identityPersonCount: number;
    hasLocationSlot: boolean;
  },
  viewerUserId: string,
  purchased: boolean,
): PublicPeachPhotoTemplate {
  const isAuthor = row.userId === viewerUserId;
  const owned = userOwnsTemplate({
    isAuthor,
    isJuice: row.isJuice,
    priceCredits: row.priceCredits,
    purchased,
  });
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    category: row.category as TemplateCategory,
    isJuice: row.isJuice,
    priceCredits: row.priceCredits,
    previewImageUrl: row.previewImageUrl,
    sceneImageUrl: row.sceneImageUrl || row.previewImageUrl,
    orientation: row.orientation,
    identityPersonCount: 1,
    hasLocationSlot: row.hasLocationSlot,
    owned,
    isAuthor,
  };
}

export async function listPublishedPeachPhotoTemplates(
  userId: string,
  category?: TemplateCategory,
) {
  const rows = await prisma.peachPhotoTemplate.findMany({
    where: {
      published: true,
      ...(category ? { category } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  const ids = rows.map((r) => r.id);
  const purchases = ids.length
    ? await prisma.peachPhotoTemplatePurchase.findMany({
        where: { userId, templateId: { in: ids } },
        select: { templateId: true },
      })
    : [];
  const ownedSet = new Set(purchases.map((p) => p.templateId));
  return rows.map((r) => toPublic(r, userId, ownedSet.has(r.id)));
}

export async function getPeachPhotoTemplateDetail(
  userId: string,
  templateId: string,
): Promise<PeachPhotoTemplateDetail | null> {
  const row = await prisma.peachPhotoTemplate.findFirst({
    where: { id: templateId, published: true },
  });
  if (!row) return null;
  const purchase = await prisma.peachPhotoTemplatePurchase.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  const pub = toPublic(row, userId, !!purchase);
  const emptyDetail = {
    ...pub,
    legoQuery: "",
    poseId: "",
    styleId: "",
    skinDetail: false,
    skinDetailStrength: 1.2,
    slotBlueprint: [] as TemplateSlotBlueprint[],
    defaultLocationUrl: "",
  };
  if (!pub.owned) return emptyDetail;

  const authorNames = await authorCharacterNamesForGallery(row.sourceGalleryId);
  const legoQuery = stripLegoCharacterNames(row.legoQuery, authorNames);

  return {
    ...pub,
    legoQuery,
    poseId: row.poseId,
    styleId: row.styleId,
    skinDetail: row.skinDetail,
    skinDetailStrength: row.skinDetailStrength,
    slotBlueprint: parseBlueprint(row.slotBlueprintJson),
    defaultLocationUrl: row.defaultLocationUrl,
  };
}

export async function createPeachPhotoTemplateFromGallery(opts: {
  userId: string;
  sourceGalleryId: string;
  title: string;
  notes?: string;
  category: TemplateCategory;
  isJuice: boolean;
  priceCredits: number;
  published?: boolean;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.sourceGalleryId, userId: opts.userId },
  });
  if (!item) throw new Error("Генерация не найдена");
  if (item.kind !== "photo") {
    throw new Error("Шаблон фото можно сохранить только из фото-генерации");
  }
  if (!item.resultUrl || item.resultUrl === GALLERY_PLACEHOLDER_URL) {
    throw new Error("Сохраняй шаблон только после успешной генерации");
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const characterIds = Array.isArray(meta.characterIds)
    ? (meta.characterIds as string[]).filter(Boolean)
    : item.characterId
      ? [item.characterId]
      : [];
  const authorChars = characterIds.length
    ? await prisma.character.findMany({
        where: { id: { in: characterIds }, userId: opts.userId },
        select: { name: true },
      })
    : [];
  const legoQueryRaw = String(meta.legoQuery || meta.userNote || item.prompt || "");
  const legoQuery = stripLegoCharacterNames(
    legoQueryRaw,
    authorChars.map((c) => c.name),
  );
  if (!legoQuery.trim()) {
    throw new Error("В генерации нет LEGO-запроса");
  }

  const refSlots = parseRefSlotsJson(String(meta.refSlotsJson || "[]"));
  const refImageUrls =
    Array.isArray(meta.refImageUrls)
      ? (meta.refImageUrls as string[])
      : parseRefUrlsJson(String(meta.refImageUrlsJson || "[]"));

  const blueprint = buildBlueprintFromGallery(
    refSlots,
    refImageUrls,
    item.resultUrl,
  );
  const hasLocationSlot = blueprint.some((b) => b.role === "location");
  const defaultLocationUrl =
    blueprint.find((b) => b.role === "location")?.bakedRefUrl || "";

  const priceCredits = opts.isJuice
    ? Math.max(0, Math.min(500, Math.floor(opts.priceCredits)))
    : 0;

  const tpl = await prisma.peachPhotoTemplate.create({
    data: {
      userId: opts.userId,
      title: opts.title.trim().slice(0, 120) || item.title || "Photo template",
      notes: (opts.notes || "").trim().slice(0, 500),
      category: opts.category,
      isJuice: opts.isJuice,
      priceCredits,
      published: opts.published !== false,
      sourceGalleryId: item.id,
      legoQuery: legoQuery.trim(),
      orientation: String(meta.orientationId || "9_16"),
      poseId: String(meta.poseId || ""),
      styleId: String(meta.styleId || ""),
      skinDetail: !!meta.skinDetail,
      skinDetailStrength: Number(meta.skinDetailStrength) || 1.2,
      previewImageUrl: item.resultUrl,
      sceneImageUrl: item.resultUrl,
      slotBlueprintJson: JSON.stringify(blueprint),
      identityPersonCount: 1,
      hasLocationSlot,
      defaultLocationUrl,
      refImageUrlsJson: JSON.stringify(
        refImageUrls.length ? refImageUrls : [item.resultUrl],
      ),
    },
  });

  return getPeachPhotoTemplateDetail(opts.userId, tpl.id);
}

export async function purchasePeachPhotoTemplate(
  userId: string,
  templateId: string,
) {
  const row = await prisma.peachPhotoTemplate.findFirst({
    where: { id: templateId, published: true },
  });
  if (!row) throw new Error("Шаблон не найден");

  const existing = await prisma.peachPhotoTemplatePurchase.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  if (existing || row.userId === userId) {
    return getPeachPhotoTemplateDetail(userId, templateId);
  }

  const price = row.isJuice ? Math.max(0, row.priceCredits) : 0;
  if (price <= 0) {
    await prisma.peachPhotoTemplatePurchase.create({
      data: { userId, templateId, paidCredits: 0 },
    });
    return getPeachPhotoTemplateDetail(userId, templateId);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("auth");
  if (user.credits < price) {
    throw new Error(
      `Нужно ${price} кредитов для покупки шаблона, у вас ${user.credits}`,
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: price } },
    }),
    prisma.peachPhotoTemplatePurchase.create({
      data: { userId, templateId, paidCredits: price },
    }),
    prisma.ledgerEntry.create({
      data: {
        userId,
        amount: -price,
        reason: "peach_photo_template_purchase",
        metaJson: JSON.stringify({ templateId, title: row.title }),
      },
    }),
  ]);

  return getPeachPhotoTemplateDetail(userId, templateId);
}
