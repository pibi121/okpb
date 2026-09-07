import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { GalleryGrid } from "@/components/gallery-grid";
import { mapGalleryItem, parseGalleryMeta } from "@/lib/gallery-meta";

export default async function PeachGalleryPage() {
  const user = await requireUser();
  if (!user) return null;

  const rows = await prisma.galleryItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  const root = rows.filter((i) => {
    const m = parseGalleryMeta(i.metaJson);
    if (i.kind === "film_folder" || m.isFolder) return true;
    if (typeof m.folderId === "string") return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Галерея</h2>
        <p className="text-sm text-zinc-600">
          Папки мини-фильмов · клик по фото увеличивает · ✎ edit · ↻ regen · Оживить.
        </p>
      </div>
      <GalleryGrid initialItems={root.slice(0, 100).map((i) => mapGalleryItem(i))} />
    </div>
  );
}
