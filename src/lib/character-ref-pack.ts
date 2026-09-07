/**
 * Resolve MiniMax identity reference tiles from character identity pack,
 * then training dataset, then latest gallery still.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import {
  characterImagesDir,
  listCharacterPhotos,
  trainingPhotosArchived,
} from "@/lib/character-dataset";
import { listIdentityPackGalleryItems, IDENTITY_PACK_ANGLES } from "@/lib/character-identity-pack";
import { localBytesFromResultUrl } from "@/lib/peach-lab";

/** Identity pack = 5 canonical angles; use all when available. */
export const MAX_IDENTITY_REFS = 5;
/** MiniMax Ref2V accepts ref_image_0…8 (9 tiles). Keep one free if context frame is added later. */
export const MAX_TOTAL_IMAGE_REFS = 9;

export type CharacterIdentityRef = {
  characterId: string;
  characterName: string;
  photoName: string;
  bytes: Buffer;
  source: "identity_pack" | "dataset" | "gallery";
};

/** Spread picks across the dataset for face/body variety. */
export function pickSpreadIndices(count: number, max: number): number[] {
  if (count <= 0 || max <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>([0, count - 1]);
  if (max >= 3) out.add(Math.floor(count / 2));
  if (max >= 4) out.add(Math.floor((2 * count) / 3));
  return [...out].sort((a, b) => a - b).slice(0, max);
}

export type CharacterRefPhotoUrl = {
  name: string;
  url: string;
  source: "identity_pack" | "dataset" | "gallery";
  label?: string;
};

function sortIdentityPackItems<T extends { metaJson: string }>(items: T[]): T[] {
  const order = new Map(IDENTITY_PACK_ANGLES.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    let ai = 999;
    let bi = 999;
    try {
      const ma = JSON.parse(a.metaJson || "{}") as { identityPackAngle?: string };
      const mb = JSON.parse(b.metaJson || "{}") as { identityPackAngle?: string };
      ai = order.get(ma.identityPackAngle as typeof IDENTITY_PACK_ANGLES[number]) ?? 999;
      bi = order.get(mb.identityPackAngle as typeof IDENTITY_PACK_ANGLES[number]) ?? 999;
    } catch {
      /* ignore */
    }
    return ai - bi;
  });
}

/** UI / quick-video: list ref photo URLs (identity pack → dataset → gallery). */
export async function listCharacterRefPhotosForUi(
  userId: string,
  characterId: string,
): Promise<CharacterRefPhotoUrl[]> {
  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId },
  });
  if (!ch) return [];

  const packItems = sortIdentityPackItems(
    await listIdentityPackGalleryItems(userId, characterId),
  );
  if (packItems.length) {
    return packItems.map((item) => {
      let angle = "ref";
      try {
        const m = JSON.parse(item.metaJson || "{}") as { identityPackAngle?: string };
        angle = m.identityPackAngle || angle;
      } catch {
        /* ignore */
      }
      return {
        name: `${angle}.png`,
        url: item.resultUrl,
        source: "identity_pack" as const,
        label: angle,
      };
    });
  }

  const photos =
    trainingPhotosArchived(characterId) || ch.loraStatus === "lora_ready"
      ? []
      : listCharacterPhotos(characterId);
  if (photos.length) {
    return photos.map((p) => ({
      name: p.name,
      url: p.url,
      source: "dataset" as const,
    }));
  }

  const gallery = await prisma.galleryItem.findMany({
    where: {
      userId,
      characterId,
      kind: "photo",
      NOT: { resultUrl: GALLERY_PLACEHOLDER_URL },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return gallery.map((g) => ({
    name: path.basename(g.resultUrl),
    url: g.resultUrl,
    source: "gallery" as const,
  }));
}

/** Count refs available for video (for character picker labels). */
export async function countCharacterRefPhotos(
  userId: string,
  characterId: string,
): Promise<number> {
  const refs = await listCharacterRefPhotosForUi(userId, characterId);
  return refs.length;
}

export async function resolveCharacterIdentityRefs(
  userId: string,
  characterIds: string[],
  maxTotal = MAX_IDENTITY_REFS,
): Promise<CharacterIdentityRef[]> {
  const ids = characterIds.filter(Boolean).slice(0, 4);
  if (!ids.length) return [];

  const out: CharacterIdentityRef[] = [];
  const perChar = Math.max(1, Math.floor(maxTotal / ids.length));

  for (const charId of ids) {
    if (out.length >= maxTotal) break;
    const ch = await prisma.character.findFirst({
      where: { id: charId, userId },
    });
    if (!ch) continue;

    const budget = Math.min(perChar, maxTotal - out.length);
    const packItems = sortIdentityPackItems(
      await listIdentityPackGalleryItems(userId, charId),
    );

    if (packItems.length) {
      const indices =
        packItems.length <= budget
          ? Array.from({ length: packItems.length }, (_, i) => i)
          : pickSpreadIndices(packItems.length, budget);
      for (const idx of indices) {
        const item = packItems[idx];
        if (!item) continue;
        const bytes = localBytesFromResultUrl(item.resultUrl);
        if (!bytes?.length) continue;
        let angle = "ref";
        try {
          const m = JSON.parse(item.metaJson || "{}") as { identityPackAngle?: string };
          angle = m.identityPackAngle || angle;
        } catch {
          /* ignore */
        }
        out.push({
          characterId: charId,
          characterName: ch.name,
          photoName: `${angle}.png`,
          bytes,
          source: "identity_pack",
        });
      }
      continue;
    }

    const photos =
      trainingPhotosArchived(charId) || ch.loraStatus === "lora_ready"
        ? []
        : listCharacterPhotos(charId);

    if (photos.length) {
      for (const idx of pickSpreadIndices(photos.length, budget)) {
        const p = photos[idx];
        if (!p) continue;
        const abs = path.join(characterImagesDir(charId), p.name);
        out.push({
          characterId: charId,
          characterName: ch.name,
          photoName: p.name,
          bytes: fs.readFileSync(abs),
          source: "dataset",
        });
      }
      continue;
    }

    const gallery = await prisma.galleryItem.findFirst({
      where: {
        userId,
        characterId: charId,
        kind: "photo",
        NOT: { resultUrl: GALLERY_PLACEHOLDER_URL },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!gallery) continue;
    const bytes = localBytesFromResultUrl(gallery.resultUrl);
    if (!bytes?.length) continue;
    out.push({
      characterId: charId,
      characterName: ch.name,
      photoName: path.basename(gallery.resultUrl),
      bytes,
      source: "gallery",
    });
  }

  return out;
}
