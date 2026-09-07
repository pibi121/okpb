import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { mapGalleryItem, parseGalleryMeta } from "@/lib/gallery-meta";
import { GalleryFolderView } from "@/components/gallery-folder-view";

type Ctx = { params: Promise<{ id: string }> };

export default async function GalleryFolderPage({ params }: Ctx) {
  const user = await requireUser();
  if (!user) return null;
  const { id } = await params;

  const folder = await prisma.galleryItem.findFirst({
    where: { id, userId: user.id },
  });
  if (!folder) notFound();
  const meta = parseGalleryMeta(folder.metaJson);
  if (folder.kind !== "film_folder" && !meta.isFolder) notFound();

  const childIds = Array.isArray(meta.childIds)
    ? (meta.childIds as string[])
    : [];
  const children =
    childIds.length > 0
      ? await prisma.galleryItem.findMany({
          where: { userId: user.id, id: { in: childIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/peach/gallery" className="text-xs text-zinc-500 underline">
          ← галерея
        </Link>
        <h2 className="text-lg font-medium">{folder.title || "Мини-фильм"}</h2>
        <p className="text-sm text-zinc-600">
          {folder.prompt || "Папка с кадрами и клипами"}
        </p>
        {typeof meta.filmProjectId === "string" ? (
          <Link
            href={`/peach/video/${meta.filmProjectId}`}
            className="mt-1 inline-block text-sm text-rose-800 underline"
          >
            Открыть проект
          </Link>
        ) : null}
      </div>
      <GalleryFolderView
        folder={mapGalleryItem(folder)}
        items={children.map(mapGalleryItem)}
      />
    </div>
  );
}
