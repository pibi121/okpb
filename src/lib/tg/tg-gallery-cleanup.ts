import { prisma } from "@/lib/db";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";

/** Drop broken TG gallery stubs (legacy mock / empty placeholder). */
export async function cleanupLegacyTgGalleryItems(userId: string): Promise<number> {
  const rows = await prisma.galleryItem.findMany({
    where: { userId, kind: { in: ["photo", "video"] } },
    select: { id: true, resultUrl: true, metaJson: true },
    take: 200,
  });

  const ids: string[] = [];
  for (const row of rows) {
    let meta: { mock?: boolean; status?: string } = {};
    try {
      meta = JSON.parse(row.metaJson || "{}") as { mock?: boolean; status?: string };
    } catch {
      /* ignore */
    }
    const legacyMock =
      row.resultUrl.startsWith("data:image/svg") ||
      (meta.mock === true &&
        (row.resultUrl === GALLERY_PLACEHOLDER_URL || !row.resultUrl.trim()));
    if (legacyMock) ids.push(row.id);
  }

  if (!ids.length) return 0;
  await prisma.galleryItem.deleteMany({ where: { id: { in: ids }, userId } });
  return ids.length;
}
