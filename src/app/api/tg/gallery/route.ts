import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mapGalleryItem, parseGalleryMeta } from "@/lib/gallery-meta";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { cleanupLegacyTgGalleryItems } from "@/lib/tg/tg-gallery-cleanup";

/** TG Mini App gallery — user's generated photos & videos. */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  await cleanupLegacyTgGalleryItems(userId);

  if (id) {
    const row = await prisma.galleryItem.findFirst({
      where: { id, userId },
    });
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ item: mapGalleryItem(row) });
  }

  const items = await prisma.galleryItem.findMany({
    where: {
      userId,
      kind: { in: ["photo", "video"] },
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  const root = items.filter((i) => {
    const m = parseGalleryMeta(i.metaJson);
    if (typeof m.folderId === "string") return false;
    return true;
  });

  return NextResponse.json({
    items: root
      .slice(0, 80)
      .map((i) => mapGalleryItem(i))
      .filter((i) => i.status !== "error"),
  });
}
