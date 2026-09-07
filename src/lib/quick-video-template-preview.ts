import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { extractFrameAtSec } from "@/lib/ffmpeg-stitch";
import { localPathFromResultUrl, saveGalleryBinary } from "@/lib/local-store";
import { galleryRoot } from "@/lib/paths";
import {
  TEMPLATE_PREVIEW_PREFIX,
  isSafeVideoTemplateThumb,
} from "@/lib/quick-video-preview-safe";

export {
  TEMPLATE_PREVIEW_PREFIX,
  isSafeVideoTemplateThumb,
} from "@/lib/quick-video-preview-safe";

export function resolveVideoLocalPath(resultUrl: string): string | null {
  const fromApi = localPathFromResultUrl(resultUrl);
  if (fromApi) return fromApi;
  const u = resultUrl.trim();
  if (u.startsWith("/tg/catalog/")) {
    const name = u.replace(/^\/tg\/catalog\//, "").split("?")[0] || "";
    const durable = path.join(galleryRoot(), "tg-catalog", name);
    if (fs.existsSync(durable)) return durable;
    const pub = path.join(process.cwd(), "public", "tg", "catalog", name);
    if (fs.existsSync(pub)) return pub;
  }
  if (u.startsWith("/api/media/tg-catalog/")) {
    const name =
      u.replace(/^\/api\/media\/tg-catalog\//, "").split("?")[0] || "";
    const durable = path.join(galleryRoot(), "tg-catalog", name);
    if (fs.existsSync(durable)) return durable;
  }
  return null;
}

export async function previewPhotoFromVideoFrame(
  userId: string,
  resultVideoUrl: string,
  atSec = 1,
): Promise<string> {
  const videoPath = resolveVideoLocalPath(resultVideoUrl);
  if (!videoPath) return "";
  try {
    const frameBytes = await extractFrameAtSec(videoPath, atSec);
    const saved = saveGalleryBinary(
      userId,
      "png",
      frameBytes,
      TEMPLATE_PREVIEW_PREFIX,
    );
    return saved.publicUrl;
  } catch (e) {
    console.error("[peach] video template thumb extract failed:", e);
    return "";
  }
}

/**
 * Ensure previewPhotoUrl is a frame from the result video (~1s), never a ref still.
 * Returns "" if extraction fails — callers must not fall back to identity/refs.
 */
export async function ensureTemplatePreviewPhoto(
  row: {
    id: string;
    userId: string;
    previewVideoUrl: string;
    previewPhotoUrl: string;
  },
  opts?: { force?: boolean; atSec?: number },
): Promise<string> {
  if (!row.previewVideoUrl?.trim()) {
    if (row.previewPhotoUrl && !isSafeVideoTemplateThumb(row.previewPhotoUrl)) {
      await prisma.quickVideoTemplate.update({
        where: { id: row.id },
        data: { previewPhotoUrl: "" },
      });
    }
    return isSafeVideoTemplateThumb(row.previewPhotoUrl)
      ? row.previewPhotoUrl
      : "";
  }

  if (!opts?.force && isSafeVideoTemplateThumb(row.previewPhotoUrl)) {
    return row.previewPhotoUrl;
  }

  const previewPhotoUrl = await previewPhotoFromVideoFrame(
    row.userId,
    row.previewVideoUrl,
    opts?.atSec ?? 1,
  );
  const next = previewPhotoUrl || "";
  if (next !== row.previewPhotoUrl) {
    await prisma.quickVideoTemplate.update({
      where: { id: row.id },
      data: { previewPhotoUrl: next },
    });
  }
  return next;
}
