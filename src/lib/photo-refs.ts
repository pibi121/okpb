/**
 * Server-only photo ref resolution (DB, gallery bytes, character packs).
 */
import { resolveCharacterIdentityRefs } from "@/lib/character-ref-pack";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { prisma } from "@/lib/db";
import {
  type PhotoManualSlot,
  PHOTO_FACE_REF_COUNT,
  parseRefSlotsJson,
  parseRefUrlsJson,
} from "@/lib/photo-refs-shared";

export {
  PHOTO_FACE_REF_COUNT,
  parseRefSlotsJson,
  parseRefUrlsJson,
  type PhotoManualSlot,
} from "@/lib/photo-refs-shared";

function firstIdentityBuffer(manualSlots: PhotoManualSlot[]): Buffer | null {
  const slot = manualSlots.find(
    (s) => s.pictureIndex === 1 && s.role === "identity",
  );
  return slot?.bytes?.length ? slot.bytes : null;
}

export async function resolvePhotoTemplateSceneBuffer(
  userId: string,
  templateId: string,
): Promise<Buffer | null> {
  const row = await prisma.peachPhotoTemplate.findFirst({
    where: { id: templateId, published: true },
  });
  if (!row) return null;
  const purchase = await prisma.peachPhotoTemplatePurchase.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  const owned =
    row.userId === userId ||
    !row.isJuice ||
    row.priceCredits <= 0 ||
    !!purchase;
  if (!owned) return null;
  const url = row.sceneImageUrl || row.previewImageUrl;
  if (!url) return null;
  return localBytesFromResultUrl(url) || null;
}

/** Person ref — manual upload wins, then custom files, then character pack (1 face). */
export async function resolvePhotoPersonBuffer(opts: {
  userId: string;
  characterIds: string[];
  customIdentityBuffers?: Buffer[];
  manualSlots?: PhotoManualSlot[];
}): Promise<Buffer | null> {
  const manual = firstIdentityBuffer(opts.manualSlots || []);
  if (manual?.length) return manual;

  if (opts.customIdentityBuffers?.length) {
    return opts.customIdentityBuffers[0]!;
  }

  const dbIds = opts.characterIds.filter((id) => id && !id.startsWith("custom:"));
  if (dbIds.length) {
    const refs = await resolveCharacterIdentityRefs(opts.userId, dbIds, 1);
    if (refs[0]?.bytes?.length) return refs[0].bytes;
  }

  return null;
}
