import { prisma } from "@/lib/db";
import { parseGalleryMeta } from "@/lib/gallery-meta";

/** Attach quickVideoRunId to gallery video meta when only the DB link exists. */
export async function enrichGalleryVideosWithRunIds<
  T extends { id: string; kind: string; metaJson: string },
>(userId: string, items: T[]): Promise<T[]> {
  const videoIds = items
    .filter((i) => i.kind === "video")
    .map((i) => i.id);
  if (!videoIds.length) return items;

  const runs = await prisma.quickVideoRun.findMany({
    where: { userId, galleryItemId: { in: videoIds } },
    select: { id: true, galleryItemId: true },
  });
  if (!runs.length) return items;

  const runByGallery = new Map(
    runs
      .filter((r): r is typeof r & { galleryItemId: string } => !!r.galleryItemId)
      .map((r) => [r.galleryItemId, r.id]),
  );

  return items.map((item) => {
    if (item.kind !== "video") return item;
    const meta = parseGalleryMeta(item.metaJson);
    if (typeof meta.quickVideoRunId === "string" && meta.quickVideoRunId) {
      return item;
    }
    const runId = runByGallery.get(item.id);
    if (!runId) return item;
    return {
      ...item,
      metaJson: JSON.stringify({ ...meta, quickVideoRunId: runId }),
    };
  });
}
