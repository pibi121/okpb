/**
 * Film-specific wrappers around peach-lab Comfy helpers.
 *
 * Avoid parallel ssh.exe while the Metalnode tunnel is up — remote MaxSessions
 * often kills the tunnel. Stitch uploads clips via Comfy HTTP (/upload/image).
 */
import {
  generatePhotoBytes,
  localBytesFromResultUrl,
  runI2VFromStill,
  runRef2VClip,
} from "@/lib/peach-lab";
import {
  comfyOutputAbsPath,
  comfyUploadImage,
  ensureComfyReady,
  runComfyJob,
  comfyStitchTimeoutMs,
} from "@/lib/comfy-client";
import { buildStitchGraph, buildAceStepGraph, buildBgmMixGraph } from "@/lib/video-graphs";
import { localPathFromResultUrl, saveGalleryBinary } from "@/lib/local-store";
import { ffmpegStitchTempPath, stitchClipsFfmpeg } from "@/lib/ffmpeg-stitch";
import fs from "node:fs";
import { useComfy } from "@/lib/metalnode-config";
import { ollamaUnload } from "@/lib/ollama-client";

export { generatePhotoBytes };

export async function runRef2VClipPublic(
  opts: Parameters<typeof runRef2VClip>[0],
) {
  await ollamaUnload();
  if (!useComfy()) throw new Error("Comfy отключён");
  await ensureComfyReady(20, 1500);
  return runRef2VClip(opts);
}

export async function runI2VFromStillPublic(
  opts: Parameters<typeof runI2VFromStill>[0],
) {
  await ollamaUnload();
  if (!useComfy()) throw new Error("Comfy отключён");
  await ensureComfyReady(20, 1500);
  return runI2VFromStill(opts);
}

/**
 * Concat gallery clips locally with ffmpeg (same files the UI already has).
 * AutoEdit on the GPU re-encodes every frame and used to hit Comfy wait timeouts.
 */
export async function stitchFilmClips(opts: {
  userId: string;
  projectId: string;
  clipResultUrls: string[];
  withMusic?: boolean;
  musicNote?: string;
  durationSec?: number;
}) {
  await ollamaUnload();

  if (!opts.clipResultUrls.length) {
    throw new Error("нет клипов для склейки");
  }

  const clipPaths = opts.clipResultUrls.map((url, i) => {
    const abs = localPathFromResultUrl(url);
    if (!abs) throw new Error(`клип ${i + 1}: локальный файл не найден`);
    return abs;
  });

  const runId = Date.now().toString(36);
  const tmpOut = ffmpegStitchTempPath(`${opts.projectId}_${runId}`);
  let width = 888;
  let height = 1176;
  let bytes: Buffer | undefined;
  let engine = "ffmpeg-concat";
  let stitchedRef: { filename: string; subfolder: string; type: string } | null = null;

  try {
    const size = await stitchClipsFfmpeg({
      clipPaths,
      outPath: tmpOut,
      trimStartSec: 0.5,
    });
    width = size.width;
    height = size.height;
    bytes = fs.readFileSync(tmpOut);
  } catch (e) {
    console.warn(
      "[peach] ffmpeg stitch failed, AutoEdit fallback:",
      e instanceof Error ? e.message.slice(0, 240) : e,
    );
    if (!useComfy()) throw e instanceof Error ? e : new Error(String(e));
    await ensureComfyReady(20, 1500);
    const subfolder = `peach_stitch/${opts.projectId}_${runId}`;
    for (let i = 0; i < opts.clipResultUrls.length; i++) {
      const clipBytes = localBytesFromResultUrl(opts.clipResultUrls[i]);
      if (!clipBytes?.length) throw new Error(`клип ${i + 1}: локальный файл не найден`);
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
        filenamePrefix: `peach/film/${opts.projectId}`,
        trimStart: true,
        trimStartSec: 0.5,
      }),
      "peach-film-stitch",
      comfyStitchTimeoutMs(opts.clipResultUrls.length),
    );
    bytes = stitched.bytes;
    engine = "minimax_h3+autoedit";
    stitchedRef = stitched.ref;
  } finally {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }

  if (opts.withMusic) {
    try {
      if (!useComfy()) throw new Error("Comfy отключён");
      await ensureComfyReady(20, 1500);
      const seconds = Math.max(12, opts.durationSec || 24);
      const bgm = await runComfyJob(
        buildAceStepGraph({
          seconds,
          filenamePrefix: `audio/peach_film_${opts.projectId}`,
          tags: opts.musicNote?.trim() || undefined,
        }),
        "peach-film-bgm",
        240_000,
      );
      const videoPath = stitchedRef
        ? comfyOutputAbsPath(stitchedRef)
        : undefined;
      if (videoPath) {
        const mixed = await runComfyJob(
          buildBgmMixGraph({
            videoPath,
            audioPath: comfyOutputAbsPath(bgm.ref),
            filenamePrefix: `peach/film/${opts.projectId}_bgm`,
          }),
          "peach-film-mix",
          comfyStitchTimeoutMs(opts.clipResultUrls.length),
        );
        bytes = mixed.bytes;
        engine = `${engine}+ace`;
      }
    } catch (e) {
      console.error("[peach] film stitch BGM failed:", e);
      engine = `${engine}+bgm_fail`;
    }
  }

  if (!bytes?.length || bytes.length < 100) {
    throw new Error("Монтаж вернул пустой файл");
  }

  const saved = saveGalleryBinary(
    opts.userId,
    "mp4",
    bytes,
    `film_${opts.projectId}_final`,
  );
  return {
    ...saved,
    engine,
    width,
    height,
  };
}
