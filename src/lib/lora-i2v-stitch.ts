/**
 * Stitch LoRA→I2V gallery clips for multi-shot templates.
 * Prefer local ffmpeg (incl. bundled static bins); fall back to Comfy AutoEdit.
 * Long work runs via enqueue (HTTP must return immediately — Railway 502 otherwise).
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
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import {
  comfyStitchTimeoutMs,
  comfyUploadImage,
  ensureComfyReady,
  runComfyJob,
} from "@/lib/comfy-client";
import { buildStitchGraph } from "@/lib/video-graphs";
import { useComfy } from "@/lib/metalnode-config";
import { enqueueGpuJob } from "@/lib/gallery-jobs";

type OrderedClip = {
  item: { id: string; metaJson: string | null };
  url: string;
  abs: string;
};

async function loadOrderedClips(opts: {
  userId: string;
  videoItemIds: string[];
}): Promise<OrderedClip[]> {
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
  return opts.videoItemIds.map((id, i) => {
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
}

function durationFromOrdered(ordered: OrderedClip[]) {
  return clampLoraI2vDurationSec(
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
}

async function renderStitchBytes(opts: {
  userId: string;
  ordered: OrderedClip[];
  runId: string;
}): Promise<{ bytes: Buffer; width: number; height: number; engine: string }> {
  const tmpOut = ffmpegStitchTempPath(`li2v_${opts.userId}_${opts.runId}`);
  let width = 0;
  let height = 0;
  let bytes: Buffer | undefined;
  let engine = "ffmpeg-concat";

  try {
    try {
      const size = await stitchClipsFfmpeg({
        clipPaths: opts.ordered.map((c) => c.abs),
        outPath: tmpOut,
        trimStartSec: 0,
      });
      width = size.width;
      height = size.height;
      bytes = fs.readFileSync(tmpOut);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        "[peach] lora-i2v ffmpeg stitch failed, Comfy fallback:",
        msg.slice(0, 240),
      );
      if (!useComfy()) {
        throw new Error(
          `Склейка: нет ffmpeg/ffprobe (${msg.slice(0, 120)}). Установи ffmpeg или включи Comfy.`,
        );
      }
      await ensureComfyReady(20, 1500);
      const subfolder = `peach_li2v_stitch/${opts.userId}_${opts.runId}`;
      for (let i = 0; i < opts.ordered.length; i++) {
        const clipBytes = localBytesFromResultUrl(opts.ordered[i]!.url);
        if (!clipBytes?.length) {
          throw new Error(`Клип ${i + 1}: локальный файл не найден`);
        }
        await comfyUploadImage(
          `s${String(i + 1).padStart(2, "0")}.mp4`,
          clipBytes,
          "video/mp4",
          subfolder,
        );
      }
      const stitchDir = `/work/ComfyUI/input/${subfolder}`;
      const stitched = await runComfyJob(
        buildStitchGraph({
          directoryPath: stitchDir,
          filenamePrefix: `peach/li2v/${opts.userId}`,
          trimStart: false,
          trimStartSec: 0,
        }),
        "peach-li2v-stitch",
        comfyStitchTimeoutMs(opts.ordered.length),
      );
      bytes = stitched.bytes;
      engine = "minimax_h3+autoedit";
      width = 0;
      height = 0;
    }
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
  return { bytes, width, height, engine };
}

/** Sync path kept for scripts/tests — prefer enqueueLoraI2vStitchJob in HTTP. */
export async function stitchLoraI2vGalleryClips(opts: {
  userId: string;
  videoItemIds: string[];
  title?: string;
}) {
  const ordered = await loadOrderedClips(opts);
  const runId = Date.now().toString(36);
  const rendered = await renderStitchBytes({
    userId: opts.userId,
    ordered,
    runId,
  });
  const saved = saveGalleryBinary(
    opts.userId,
    "mp4",
    rendered.bytes,
    `li2v_stitch_${runId}`,
  );
  const durationSec = durationFromOrdered(ordered);
  const gallery = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "video",
      title: (opts.title || "LoRA I2V stitch").slice(0, 120),
      prompt: `stitch:${opts.videoItemIds.join(",")}`,
      resultUrl: saved.publicUrl,
      width: rendered.width || null,
      height: rendered.height || null,
      metaJson: JSON.stringify({
        status: "ready",
        engine: rendered.engine,
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
    width: rendered.width,
    height: rendered.height,
  };
}

/**
 * Fast HTTP: validate clips + create pending gallery row, stitch in GPU queue.
 * Avoids Railway edge 502 on long ffmpeg/Comfy work.
 */
export async function enqueueLoraI2vStitchJob(opts: {
  userId: string;
  videoItemIds: string[];
  title?: string;
}) {
  const ordered = await loadOrderedClips(opts);
  const durationSec = durationFromOrdered(ordered);
  const title = (opts.title || "LoRA I2V stitch").slice(0, 120);

  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "video",
      title,
      prompt: `stitch:${opts.videoItemIds.join(",")}`,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        jobAction: "lora_i2v_stitch",
        sourceVideoIds: opts.videoItemIds,
        durationSec,
      }),
    },
  });

  void enqueueGpuJob(
    async () => {
      try {
        const runId = `${item.id.slice(0, 8)}_${Date.now().toString(36)}`;
        const rendered = await renderStitchBytes({
          userId: opts.userId,
          ordered,
          runId,
        });
        const saved = saveGalleryBinary(
          opts.userId,
          "mp4",
          rendered.bytes,
          `li2v_stitch_${runId}`,
        );
        await prisma.galleryItem.update({
          where: { id: item.id },
          data: {
            resultUrl: saved.publicUrl,
            width: rendered.width || null,
            height: rendered.height || null,
            metaJson: JSON.stringify({
              status: "ready",
              engine: rendered.engine,
              jobAction: "lora_i2v_stitch",
              sourceVideoIds: opts.videoItemIds,
              durationSec,
              localKey: saved.relKey,
            }),
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ошибка склейки";
        console.error("[peach] lora-i2v stitch job failed:", e);
        await prisma.galleryItem.update({
          where: { id: item.id },
          data: {
            metaJson: JSON.stringify({
              status: "error",
              error: msg,
              jobAction: "lora_i2v_stitch",
              sourceVideoIds: opts.videoItemIds,
              durationSec,
            }),
          },
        });
      }
    },
    {
      kind: "lora_i2v_stitch",
      pool: "video",
      userId: opts.userId,
      refType: "galleryItem",
      refId: item.id,
      title,
      meta: { sourceVideoIds: opts.videoItemIds },
    },
  );

  return {
    item: {
      id: item.id,
      resultUrl: item.resultUrl,
      kind: "video" as const,
      status: "pending" as const,
    },
    durationSec,
  };
}
