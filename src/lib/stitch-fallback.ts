/**
 * Robust local stitch for already-encoded MP4 clip files.
 * Order: lossless concat → ffmpeg re-encode → Comfy AutoEdit.
 */
import fs from "node:fs";
import {
  concatMp4sLossless,
  ffmpegStitchTempPath,
  probeMediaFile,
  stitchClipsFfmpeg,
} from "@/lib/ffmpeg-stitch";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import {
  comfyStitchTimeoutMs,
  comfyUploadImage,
  ensureComfyReady,
  runComfyJob,
} from "@/lib/comfy-client";
import { buildStitchGraph } from "@/lib/video-graphs";
import { useComfy } from "@/lib/metalnode-config";

export async function stitchClipFilesWithFallback(opts: {
  clipPaths: string[];
  outPath: string;
  /** Used for Comfy upload folder naming */
  tag?: string;
  trimStartSec?: number;
}): Promise<{ width: number; height: number; engine: string }> {
  if (opts.clipPaths.length < 2) {
    throw new Error("Нужно минимум два клипа для склейки");
  }
  for (const [i, p] of opts.clipPaths.entries()) {
    if (!p || !fs.existsSync(p) || fs.statSync(p).size < 500) {
      throw new Error(`Клип ${i + 1} пустой или не найден на диске`);
    }
  }

  const errors: string[] = [];

  // 1) Lossless concat (fast, low RAM) — works when codecs match.
  try {
    await concatMp4sLossless({
      clipPaths: opts.clipPaths,
      outPath: opts.outPath,
    });
    if (fs.existsSync(opts.outPath) && fs.statSync(opts.outPath).size >= 1000) {
      let width = 0;
      let height = 0;
      try {
        const probe = await probeMediaFile(opts.outPath);
        width = probe.width;
        height = probe.height;
      } catch {
        /* optional */
      }
      return { width, height, engine: "ffmpeg-concat-copy" };
    }
    errors.push("lossless: output too small");
  } catch (e) {
    errors.push(`lossless: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Re-encode stitch (scales/crops to first clip).
  try {
    if (fs.existsSync(opts.outPath)) {
      try {
        fs.unlinkSync(opts.outPath);
      } catch {
        /* ignore */
      }
    }
    const size = await stitchClipsFfmpeg({
      clipPaths: opts.clipPaths,
      outPath: opts.outPath,
      trimStartSec: opts.trimStartSec ?? 0,
    });
    return {
      width: size.width,
      height: size.height,
      engine: "ffmpeg-concat",
    };
  } catch (e) {
    errors.push(`reencode: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) Comfy AutoEdit on GPU.
  if (!useComfy()) {
    throw new Error(`Склейка ffmpeg failed (${errors.join(" | ")})`);
  }
  try {
    await ensureComfyReady(20, 1500);
    const runId = Date.now().toString(36);
    const tag = (opts.tag || "stitch").replace(/[^\w-]+/g, "_").slice(0, 40);
    const subfolder = `peach_clip_stitch/${tag}_${runId}`;
    for (let i = 0; i < opts.clipPaths.length; i++) {
      const bytes = fs.readFileSync(opts.clipPaths[i]!);
      await comfyUploadImage(
        `s${String(i + 1).padStart(2, "0")}.mp4`,
        bytes,
        "video/mp4",
        subfolder,
      );
    }
    const stitchDir = `/work/ComfyUI/input/${subfolder}`;
    const stitched = await runComfyJob(
      buildStitchGraph({
        directoryPath: stitchDir,
        filenamePrefix: `peach/clip_stitch/${tag}`,
        trimStart: false,
        trimStartSec: 0,
      }),
      "peach-clip-stitch",
      comfyStitchTimeoutMs(opts.clipPaths.length),
    );
    if (!stitched.bytes?.length || stitched.bytes.length < 1000) {
      throw new Error("Comfy stitch empty");
    }
    fs.writeFileSync(opts.outPath, stitched.bytes);
    return { width: 0, height: 0, engine: "minimax_h3+autoedit" };
  } catch (e) {
    errors.push(`comfy: ${e instanceof Error ? e.message : String(e)}`);
    throw new Error(`Склейка failed (${errors.join(" | ")})`);
  }
}

/** Stitch in-memory MP4 buffers via temp files + fallbacks. */
export async function stitchClipBuffersWithFallback(opts: {
  clips: Buffer[];
  tag?: string;
  trimStartSec?: number;
}): Promise<{ bytes: Buffer; width: number; height: number; engine: string }> {
  if (opts.clips.length < 2) throw new Error("Нужно минимум два клипа");
  const runId = Date.now().toString(36);
  const tag = opts.tag || "bufs";
  const paths: string[] = [];
  const outPath = ffmpegStitchTempPath(`${tag}_${runId}_out`);
  try {
    for (let i = 0; i < opts.clips.length; i++) {
      const p = ffmpegStitchTempPath(`${tag}_${runId}_s${i}`);
      fs.writeFileSync(p, opts.clips[i]!);
      paths.push(p);
    }
    const r = await stitchClipFilesWithFallback({
      clipPaths: paths,
      outPath,
      tag,
      trimStartSec: opts.trimStartSec,
    });
    const bytes = fs.readFileSync(outPath);
    return { bytes, ...r };
  } finally {
    for (const p of [...paths, outPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Convenience when callers already have gallery result URLs. */
export async function stitchGalleryUrlsWithFallback(opts: {
  resultUrls: string[];
  outPath: string;
  tag?: string;
}): Promise<{ width: number; height: number; engine: string }> {
  const { localPathFromResultUrl } = await import("@/lib/local-store");
  const paths = opts.resultUrls.map((url, i) => {
    const abs = localPathFromResultUrl(url);
    if (!abs || !fs.existsSync(abs)) {
      // last resort: materialize from bytes helper
      const bytes = localBytesFromResultUrl(url);
      if (!bytes?.length) throw new Error(`клип ${i + 1}: файл не найден`);
      const tmp = ffmpegStitchTempPath(`url_${Date.now().toString(36)}_${i}`);
      fs.writeFileSync(tmp, bytes);
      return tmp;
    }
    return abs;
  });
  return stitchClipFilesWithFallback({
    clipPaths: paths,
    outPath: opts.outPath,
    tag: opts.tag,
    trimStartSec: 0,
  });
}
