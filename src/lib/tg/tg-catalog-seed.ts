import seedJson from "./tg-catalog-seed.json";

export type TgCatalogSeed = {
  videos: Array<{
    title: string;
    durationSec: number;
    shotsJson: string;
    slotBlueprintJson: string;
    identityPersonCount: number;
    previewVideoUrl: string;
    previewPhotoUrl: string;
  }>;
  photo: {
    title: string;
    tier: string;
    editPrompt: string;
    pricePeaches: number;
    previewImageUrl: string;
    sceneImageUrl: string;
  } | null;
  castCovers: Array<{ trigger: string; coverUrl: string }>;
  syncedAt?: string;
};

const seed = seedJson as TgCatalogSeed;

export function getTgCatalogSeed(): TgCatalogSeed {
  return seed;
}

export function seedVideoByTitle(title: string) {
  return seed.videos.find((v) => v.title === title) || null;
}

export function seedVideoByIndex(index: number) {
  return seed.videos[index] ?? null;
}

export function seedPhotoTemplate() {
  return seed.photo;
}

export function seedCastCoverUrl(triggerWord?: string | null): string | null {
  if (!triggerWord) return null;
  return seed.castCovers.find((c) => c.trigger === triggerWord)?.coverUrl ?? null;
}

/** Map title → bundled preview for API fallbacks. */
export function seedPreviewForVideo(title: string, index: number) {
  const row = seedVideoByTitle(title) || seedVideoByIndex(index);
  return row
    ? {
        previewVideoUrl: row.previewVideoUrl,
        previewPhotoUrl: row.previewPhotoUrl,
      }
    : null;
}

export function seedPreviewForPhoto(title: string) {
  const p = seed.photo;
  if (!p) return null;
  if (p.title === title || title === "2") {
    return p.previewImageUrl;
  }
  return p.previewImageUrl;
}
