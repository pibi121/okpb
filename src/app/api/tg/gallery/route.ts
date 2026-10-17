import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  mapGalleryItem,
  parseGalleryMeta,
  isHiddenFromTgMiniAppGallery,
} from "@/lib/gallery-meta";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { userFacingTgError } from "@/lib/tg/user-facing-error";
import { cleanupLegacyTgGalleryItems } from "@/lib/tg/tg-gallery-cleanup";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

/** TG Mini App gallery — user's generated photos & videos. */
export async function GET(req: Request) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

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
    if (
      !row ||
      isHiddenFromTgMiniAppGallery({ metaJson: row.metaJson, title: row.title })
    ) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const item = mapGalleryItem(row);
    if (item.error) {
      item.error = userFacingTgError(
        item.error,
        "Не получилось собрать. Попробуй ещё раз.",
      );
    }
    return NextResponse.json({ item });
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
    if (isHiddenFromTgMiniAppGallery({ metaJson: i.metaJson, title: i.title })) {
      return false;
    }
    return true;
  });

  return NextResponse.json({
    items: root
      .slice(0, 80)
      .map((i) => mapGalleryItem(i))
      .filter((i) => i.status !== "error"),
  });
}
