/**
 * Stitch LoRA→I2V gallery clips for multi-shot templates.
 */
import fs from "node:fs";
import { prisma } from "@/lib/db";
import { galleryStatus, GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import {
  ffmpegStitchTempPath,
  stitchClipsFfmpeg,
} from "@/lib/ffmpeg-stitch";
import { localPathFromResultUrl, saveGalleryBinary } from "@/lib/local-store";
import { clampLoraI2vDurationSec } from "@/lib/lora-i2v-shots";

export async function stitchLoraI2vGalleryClips(opts: {
  userId: string;
  videoItemIds: string[];
  title?: string;
}) {
  if (opts.videoItemIds.length < 2) {
    throw new Error("Нужно минимум два готовых клипа");
  }

  const items = await prisma.galleryItem.findMany({
    where: {
      id: { in: opts.videoItemIds },
      userId: opts.userId,
      kind: "video",
    },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = opts.videoItemIds.map((id, i) => {
    const item = byId.get(id);
    if (!item) throw new Error(`Клип ${i + 1} не найден`);
    const st = galleryStatus(item.metaJson);
    if (st === "pending") throw new Error(`Клип ${i + 1} ещё генерируется`);
    if (st === "error") throw new Error(`Клип ${i + 1} в ошибке`);
    const url = item.resultUrl?.trim() || "";
    if (!url || url === GALLERY_PLACEHOLDER_URL) {
      throw new Error(`У клипа ${i + 1} нет файла`);
    }
    const abs = localPathFromResultUrl(url);
    if (!abs || !fs.existsSync(abs)) {
      throw new Error(`Клип ${i + 1}: локальный файл не найден`);
    }
    return { item, url, abs };
  });

  const runId = Date.now().toString(36);
  const tmpOut = ffmpegStitchTempPath(`li2v_${opts.userId}_${runId}`);
  let width = 0;
  let height = 0;
  let bytes: Buffer;
  try {
    const size = await stitchClipsFfmpeg({
      clipPaths: ordered.map((c) => c.abs),
      outPath: tmpOut,
      trimStartSec: 0,
    });
    width = size.width;
    height = size.height;
    bytes = fs.readFileSync(tmpOut);
  } finally {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }

  if (!bytes?.length || bytes.length < 1000) {
    throw new Error("Склейка вернула пустой файл");
  }

  const saved = saveGalleryBinary(
    opts.userId,
    "mp4",
    bytes,
    `li2v_stitch_${runId}`,
  );

  const durationSec = clampLoraI2vDurationSec(
    ordered.reduce((sum, c) => {
      try {
        const meta = JSON.parse(c.item.metaJson || "{}") as {
          durationSec?: number;
        };
        return sum + (Number(meta.durationSec) || 6);
      } catch {
        return sum + 6;
      }
    }, 0),
  );

  const gallery = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "video",
      title: (opts.title || "LoRA I2V stitch").slice(0, 120),
      prompt: `stitch:${opts.videoItemIds.join(",")}`,
      resultUrl: saved.publicUrl,
      width: width || null,
      height: height || null,
      metaJson: JSON.stringify({
        status: "ready",
        engine: "ffmpeg-concat",
        jobAction: "lora_i2v_stitch",
        sourceVideoIds: opts.videoItemIds,
        durationSec,
        localKey: saved.relKey,
      }),
    },
  });

  return {
    item: gallery,
    resultUrl: saved.publicUrl,
    durationSec,
    width,
    height,
  };
}
