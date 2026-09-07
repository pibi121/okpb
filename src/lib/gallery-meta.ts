export type GalleryJobStatus = "pending" | "ready" | "error";

export type GalleryMeta = {
  status?: GalleryJobStatus;
  error?: string;
  jobAction?: string;
  [key: string]: unknown;
};

export const GALLERY_PLACEHOLDER_URL = "/api/peach/gallery/placeholder";

export function parseGalleryMeta(metaJson: string | null | undefined): GalleryMeta {
  try {
    return metaJson ? (JSON.parse(metaJson) as GalleryMeta) : {};
  } catch {
    return {};
  }
}

export function galleryStatus(metaJson: string | null | undefined): GalleryJobStatus {
  const m = parseGalleryMeta(metaJson);
  if (m.status === "pending") return "pending";
  if (m.status === "error") return "error";
  return "ready";
}

/** Legacy mock SVG placeholders from before async jobs. */
export function isLegacyMockResult(resultUrl: string, metaJson: string | null | undefined) {
  if (resultUrl.startsWith("data:image/svg")) return true;
  if (resultUrl === GALLERY_PLACEHOLDER_URL || !resultUrl.trim()) {
    const m = parseGalleryMeta(metaJson);
    return m.mock === true;
  }
  // Saved /api/media/ or static files with engine mock are valid (Railway mock mode).
  return false;
}

export function mapGalleryItem<T extends { metaJson: string; createdAt: Date | string; resultUrl: string }>(
  item: T,
) {
  const meta = parseGalleryMeta(item.metaJson);
  let status = galleryStatus(item.metaJson);
  let error = typeof meta.error === "string" ? meta.error : null;
  if (status === "ready" && isLegacyMockResult(item.resultUrl, item.metaJson)) {
    status = "error";
    error = "Старая заглушка (туннель был недоступен) — удали или перегенерируй";
  }
  return {
    ...item,
    status,
    error,
    createdAt:
      typeof item.createdAt === "string"
        ? item.createdAt
        : item.createdAt.toISOString(),
  };
}
