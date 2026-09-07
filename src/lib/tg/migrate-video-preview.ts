/**
 * Scrub leaked identity/ref stills from video template public previews.
 * Thumbs must be a ~1s frame from the result video only.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { galleryRoot } from "@/lib/paths";
import {
  ensureTemplatePreviewPhoto,
  isSafeVideoTemplateThumb,
} from "@/lib/quick-video-template-preview";
import { copyAssetToTgCatalog } from "@/lib/tg/tg-publish";
import { ensureTgCatalog } from "@/lib/tg/tg-catalog";

let ran = false;

function deleteLegacyLeakedThumbs() {
  const dirs = [
    path.join(galleryRoot(), "tg-catalog"),
    path.join(process.cwd(), "public", "tg", "catalog"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      // Old publish path copied ref stills as qv-*-thumb.*
      // Keep seed video-*-thumb and new *-frame-thumb.
      if (/^qv-.+-thumb\.(jpe?g|png|webp)$/i.test(name)) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export async function migrateVideoTemplatePreviewHygiene(): Promise<{
  cleared: number;
  regenerated: number;
  republished: number;
}> {
  if (ran) return { cleared: 0, regenerated: 0, republished: 0 };
  ran = true;

  deleteLegacyLeakedThumbs();

  let cleared = 0;
  let regenerated = 0;
  let republished = 0;

  const rows = await prisma.quickVideoTemplate.findMany({
    select: {
      id: true,
      userId: true,
      previewVideoUrl: true,
      previewPhotoUrl: true,
      tgPublished: true,
      tgDisplayTitle: true,
    },
  });

  for (const row of rows) {
    const unsafe = !isSafeVideoTemplateThumb(row.previewPhotoUrl);
    if (unsafe && row.previewPhotoUrl?.trim()) {
      await prisma.quickVideoTemplate.update({
        where: { id: row.id },
        data: { previewPhotoUrl: "" },
      });
      cleared += 1;
    }

    if (!row.previewVideoUrl?.trim()) continue;

    const thumb = await ensureTemplatePreviewPhoto(
      {
        id: row.id,
        userId: row.userId,
        previewVideoUrl: row.previewVideoUrl,
        previewPhotoUrl: unsafe ? "" : row.previewPhotoUrl,
      },
      { force: unsafe || !isSafeVideoTemplateThumb(row.previewPhotoUrl), atSec: 1 },
    );
    if (thumb) regenerated += 1;

    if (row.tgPublished) {
      const fresh = await prisma.quickVideoTemplate.findUnique({
        where: { id: row.id },
      });
      if (!fresh?.previewVideoUrl) continue;
      const slug = `qv-${row.id.slice(0, 10)}`;
      const previewVideoUrl = copyAssetToTgCatalog(
        fresh.previewVideoUrl,
        `${slug}-preview`,
        ".mp4",
      );
      const previewPhotoUrl = thumb
        ? copyAssetToTgCatalog(thumb, `${slug}-frame-thumb`, ".png")
        : "";
      await prisma.quickVideoTemplate.update({
        where: { id: row.id },
        data: {
          previewVideoUrl: previewVideoUrl || fresh.previewVideoUrl,
          previewPhotoUrl: previewPhotoUrl || thumb || "",
        },
      });
      republished += 1;
    }
  }

  await ensureTgCatalog();
  console.log(
    `[peach] video preview hygiene: cleared=${cleared} regenerated=${regenerated} republished=${republished}`,
  );
  return { cleared, regenerated, republished };
}
