/**
 * Restore missing TG catalog preview videos from source runs / gallery.
 * Volume hygiene or failed copies can leave DB URLs pointing at 404 files.
 */
import { prisma } from "@/lib/db";
import {
  ensureTemplatePreviewPhoto,
  resolveVideoLocalPath,
} from "@/lib/quick-video-template-preview";
import { copyAssetToTgCatalog } from "@/lib/tg/tg-publish";
import { ensureTgCatalog } from "@/lib/tg/tg-catalog";

let ran = false;

function catalogPreviewExists(url: string): boolean {
  return Boolean(url?.trim() && resolveVideoLocalPath(url.trim()));
}

async function findGalleryVideoByTitle(
  userId: string,
  title: string,
): Promise<string> {
  const needle = title.trim().slice(0, 48);
  if (!needle) return "";
  const items = await prisma.galleryItem.findMany({
    where: {
      userId,
      kind: "video",
      OR: [
        { title: { contains: needle.slice(0, 24) } },
        { title: { contains: needle } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { resultUrl: true, title: true },
  });
  for (const it of items) {
    if (it.resultUrl && catalogPreviewExists(it.resultUrl)) return it.resultUrl;
  }
  return "";
}

async function resolveQuickVideoSource(row: {
  id: string;
  userId: string;
  title: string;
  tgDisplayTitle: string;
  previewVideoUrl: string;
  refVideoUrl: string;
  sourceRunId: string;
}): Promise<string> {
  const candidates: string[] = [];
  if (row.previewVideoUrl?.trim()) candidates.push(row.previewVideoUrl.trim());
  if (row.refVideoUrl?.trim()) candidates.push(row.refVideoUrl.trim());

  if (row.sourceRunId?.trim()) {
    const run = await prisma.quickVideoRun.findUnique({
      where: { id: row.sourceRunId },
      select: { resultVideoUrl: true, refVideoUrl: true },
    });
    if (run?.resultVideoUrl?.trim()) candidates.push(run.resultVideoUrl.trim());
    if (run?.refVideoUrl?.trim()) candidates.push(run.refVideoUrl.trim());
  }

  for (const url of candidates) {
    if (catalogPreviewExists(url)) return url;
  }

  const display = row.tgDisplayTitle.trim() || row.title;
  const fromGallery = await findGalleryVideoByTitle(row.userId, display);
  if (fromGallery) return fromGallery;

  // Last resort: any gallery clip whose meta mentions this template id.
  const recent = await prisma.galleryItem.findMany({
    where: { userId: row.userId, kind: "video" },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { resultUrl: true, metaJson: true, title: true },
  });
  for (const it of recent) {
    if (
      (it.metaJson || "").includes(row.id) &&
      it.resultUrl &&
      catalogPreviewExists(it.resultUrl)
    ) {
      return it.resultUrl;
    }
  }
  return "";
}

async function resolveLoraI2vSource(row: {
  id: string;
  userId: string;
  title: string;
  tgDisplayTitle: string;
  previewVideoUrl: string;
  sourceVideoId: string;
}): Promise<string> {
  const candidates: string[] = [];
  if (row.previewVideoUrl?.trim()) candidates.push(row.previewVideoUrl.trim());

  if (row.sourceVideoId?.trim()) {
    const gal = await prisma.galleryItem.findUnique({
      where: { id: row.sourceVideoId },
      select: { resultUrl: true },
    });
    if (gal?.resultUrl?.trim()) candidates.push(gal.resultUrl.trim());
  }

  for (const url of candidates) {
    if (catalogPreviewExists(url)) return url;
  }

  const display = row.tgDisplayTitle.trim() || row.title;
  return findGalleryVideoByTitle(row.userId, display);
}

export async function repairMissingTgVideoPreviews(opts?: {
  force?: boolean;
}): Promise<{
  quickFixed: number;
  loraFixed: number;
  quickFailed: string[];
  loraFailed: string[];
}> {
  if (ran && !opts?.force) {
    return { quickFixed: 0, loraFixed: 0, quickFailed: [], loraFailed: [] };
  }
  ran = true;

  const quickFailed: string[] = [];
  const loraFailed: string[] = [];
  let quickFixed = 0;
  let loraFixed = 0;

  const quick = await prisma.quickVideoTemplate.findMany({
    where: { tgPublished: true },
    select: {
      id: true,
      userId: true,
      title: true,
      tgDisplayTitle: true,
      previewVideoUrl: true,
      previewPhotoUrl: true,
      refVideoUrl: true,
      sourceRunId: true,
    },
  });

  for (const row of quick) {
    if (catalogPreviewExists(row.previewVideoUrl)) continue;
    const source = await resolveQuickVideoSource(row);
    if (!source) {
      quickFailed.push(row.tgDisplayTitle.trim() || row.title);
      continue;
    }
    const slug = `qv-${row.id.slice(0, 10)}`;
    const previewVideoUrl = copyAssetToTgCatalog(source, `${slug}-preview`, ".mp4");
    if (!previewVideoUrl || !catalogPreviewExists(previewVideoUrl)) {
      quickFailed.push(row.tgDisplayTitle.trim() || row.title);
      continue;
    }
    const thumb = await ensureTemplatePreviewPhoto(
      {
        id: row.id,
        userId: row.userId,
        previewVideoUrl,
        previewPhotoUrl: "",
      },
      { force: true, atSec: 1 },
    );
    const previewPhotoUrl = thumb
      ? copyAssetToTgCatalog(thumb, `${slug}-frame-thumb`, ".png")
      : "";
    await prisma.quickVideoTemplate.update({
      where: { id: row.id },
      data: {
        previewVideoUrl,
        previewPhotoUrl: previewPhotoUrl || thumb || "",
        // Keep a durable non-catalog fallback pointer when we recovered from run/gallery.
        ...(source !== row.previewVideoUrl && !row.refVideoUrl?.trim()
          ? { refVideoUrl: source }
          : {}),
      },
    });
    quickFixed += 1;
  }

  const lora = await prisma.loraI2vTemplate.findMany({
    where: { tgPublished: true },
    select: {
      id: true,
      userId: true,
      title: true,
      tgDisplayTitle: true,
      previewVideoUrl: true,
      previewImageUrl: true,
      sourceVideoId: true,
    },
  });

  for (const row of lora) {
    if (catalogPreviewExists(row.previewVideoUrl)) continue;
    const source = await resolveLoraI2vSource(row);
    if (!source) {
      loraFailed.push(row.tgDisplayTitle.trim() || row.title);
      continue;
    }
    const slug = `li2v-${row.id.slice(0, 10)}`;
    const previewVideoUrl = copyAssetToTgCatalog(source, `${slug}-preview`, ".mp4");
    if (!previewVideoUrl || !catalogPreviewExists(previewVideoUrl)) {
      loraFailed.push(row.tgDisplayTitle.trim() || row.title);
      continue;
    }
    await prisma.loraI2vTemplate.update({
      where: { id: row.id },
      data: { previewVideoUrl },
    });
    loraFixed += 1;
  }

  await ensureTgCatalog();
  console.log(
    `[peach] repair TG video previews: quick=${quickFixed} lora=${loraFixed} failQ=${quickFailed.length} failL=${loraFailed.length}`,
  );
  return { quickFixed, loraFixed, quickFailed, loraFailed };
}
