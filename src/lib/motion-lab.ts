/**
 * Wan Animate 2 motion transfer runner (Comfy).
 * Output size follows reference still orientation; duration follows driving video.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  comfyUploadImage,
  ensureComfyReady,
  runComfyJob,
} from "@/lib/comfy-client";
import {
  concatMp4sLossless,
  probeMediaBuffer,
} from "@/lib/ffmpeg-stitch";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { ollamaUnload } from "@/lib/ollama-client";
import { useComfy } from "@/lib/metalnode-config";
import {
  buildWanAnimate2Graph,
  WAN_ANIMATE2_DEFAULT_NEGATIVE,
  WAN_ANIMATE2_DEFAULT_POSE,
  WAN_ANIMATE2_DEFAULT_POSITIVE,
} from "@/lib/video-graphs";

/** Per-pass frame budget (4n+1). Longer clips are segmented + stitched. */
const WAN_ANIMATE2_SEGMENT = 81;
const WAN_ANIMATE2_MAX_FRAMES = 481; // ~30s @16fps
const WAN_ANIMATE2_LONG_EDGE = 832;

function guessMime(name: string, kind: "image" | "video") {
  const n = name.toLowerCase();
  if (kind === "video") {
    if (n.endsWith(".webm")) return "video/webm";
    if (n.endsWith(".mov")) return "video/quicktime";
    return "video/mp4";
  }
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function extOf(name: string, fallback: string) {
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : fallback;
}

/** Snap to multiple of 16 (Wan latent grid). */
function snap16(n: number) {
  return Math.max(256, Math.round(n / 16) * 16);
}

/** Wan length must be 4n+1. */
export function snapWanLength(frames: number) {
  const raw = Math.max(17, Math.round(frames));
  let n = Math.round((raw - 1) / 4);
  n = Math.max(4, n);
  return Math.min(WAN_ANIMATE2_MAX_FRAMES, n * 4 + 1);
}

/**
 * Fit reference still aspect into ~480p Wan Animate budget.
 * Portrait photo → portrait video; landscape → landscape.
 */
export function fitWanAnimateSize(srcW: number, srcH: number): {
  width: number;
  height: number;
} {
  const w0 = Math.max(1, srcW);
  const h0 = Math.max(1, srcH);
  const aspect = w0 / h0;
  let width: number;
  let height: number;
  if (aspect >= 1.05) {
    width = WAN_ANIMATE2_LONG_EDGE;
    height = Math.round(WAN_ANIMATE2_LONG_EDGE / aspect);
  } else if (aspect <= 1 / 1.05) {
    height = WAN_ANIMATE2_LONG_EDGE;
    width = Math.round(WAN_ANIMATE2_LONG_EDGE * aspect);
  } else {
    width = 640;
    height = 640;
  }
  return { width: snap16(width), height: snap16(height) };
}

export function resolveMotionTiming(opts: {
  durationSec: number;
  sourceFps: number;
  nbFrames: number;
  fpsOverride?: number;
  frameCountOverride?: number;
}) {
  const fps =
    opts.fpsOverride && opts.fpsOverride >= 8 && opts.fpsOverride <= 30
      ? opts.fpsOverride
      : 16;

  if (opts.frameCountOverride && opts.frameCountOverride >= 17) {
    return { fps, frameCount: snapWanLength(opts.frameCountOverride) };
  }

  let frames = 0;
  if (opts.durationSec > 0.05) {
    frames = Math.round(opts.durationSec * fps);
  } else if (opts.nbFrames > 0 && opts.sourceFps > 0) {
    frames = Math.round((opts.nbFrames / opts.sourceFps) * fps);
  } else if (opts.nbFrames > 0) {
    frames = opts.nbFrames;
  } else {
    frames = 81;
  }
  return { fps, frameCount: snapWanLength(frames) };
}

function segmentOffsets(totalFrames: number, segment: number): Array<{
  skip: number;
  length: number;
}> {
  const total = Math.max(17, totalFrames);
  if (total <= segment) {
    return [{ skip: 0, length: snapWanLength(total) }];
  }
  const out: Array<{ skip: number; length: number }> = [];
  let skip = 0;
  let left = total;
  while (left > 0 && out.length < 32) {
    if (left <= segment) {
      out.push({ skip, length: snapWanLength(left) });
      break;
    }
    out.push({ skip, length: segment });
    skip += segment;
    left -= segment;
  }
  return out.length ? out : [{ skip: 0, length: snapWanLength(Math.min(segment, total)) }];
}

export async function runWanAnimate2Motion(opts: {
  referenceImageBytes: Buffer;
  referenceImageName?: string;
  drivingVideoBytes: Buffer;
  drivingVideoName?: string;
  positive?: string;
  negative?: string;
  posePrompt?: string;
  /** If omitted, taken from reference still aspect. */
  width?: number;
  height?: number;
  /** If omitted, taken from driving video duration. */
  frameCount?: number;
  fps?: number;
  filenamePrefix?: string;
}) {
  await ollamaUnload();
  if (!useComfy()) throw new Error("Comfy отключён");
  await ensureComfyReady(25, 2000);

  const refNameHint = opts.referenceImageName || "ref.png";
  const driveNameHint = opts.drivingVideoName || "drive.mp4";
  const refProbe = await probeMediaBuffer(
    opts.referenceImageBytes,
    extOf(refNameHint, ".png"),
  );
  const driveProbe = await probeMediaBuffer(
    opts.drivingVideoBytes,
    extOf(driveNameHint, ".mp4"),
  );

  const autoSize = fitWanAnimateSize(refProbe.width, refProbe.height);
  const width =
    opts.width && opts.height ? snap16(opts.width) : autoSize.width;
  const height =
    opts.width && opts.height ? snap16(opts.height) : autoSize.height;

  const timing = resolveMotionTiming({
    durationSec: driveProbe.duration,
    sourceFps: driveProbe.fps,
    nbFrames: driveProbe.nbFrames,
    fpsOverride: opts.fps,
    frameCountOverride: opts.frameCount,
  });
  const fps = timing.fps;
  const totalFrames = timing.frameCount;

  const ts = Date.now();
  const refName = await comfyUploadImage(
    opts.referenceImageName || `peach_motion_ref_${ts}.png`,
    opts.referenceImageBytes,
    guessMime(refNameHint, "image"),
  );
  const driveName = await comfyUploadImage(
    opts.drivingVideoName || `peach_motion_drive_${ts}.mp4`,
    opts.drivingVideoBytes,
    guessMime(driveNameHint, "video"),
  );

  const segments = segmentOffsets(totalFrames, WAN_ANIMATE2_SEGMENT);
  const positive = opts.positive || WAN_ANIMATE2_DEFAULT_POSITIVE;
  const negative = opts.negative || WAN_ANIMATE2_DEFAULT_NEGATIVE;
  const posePrompt = opts.posePrompt || WAN_ANIMATE2_DEFAULT_POSE;
  const prefix = opts.filenamePrefix || "peach/motion";

  console.log(
    `[peach] wan-animate2 size=${width}x${height} (ref ${refProbe.width}x${refProbe.height}) ` +
      `frames=${totalFrames} @${fps}fps (drive ${driveProbe.duration.toFixed(2)}s) segments=${segments.length}`,
  );

  if (segments.length === 1) {
    const seg = segments[0]!;
    const graph = buildWanAnimate2Graph({
      referenceImageName: refName,
      drivingVideoName: driveName,
      positive,
      negative,
      posePrompt,
      width,
      height,
      length: seg.length,
      fps,
      frameLoadCap: seg.length,
      skipFirstFrames: seg.skip,
      filenamePrefix: prefix,
    });
    const out = await runComfyJob(graph, "peach-wan-animate2", 1_800_000);
    return {
      bytes: out.bytes,
      engine: "wan_animate_2_int8+lightx2v",
      width,
      height,
      frameCount: seg.length,
      fps,
    };
  }

  const tmpDir = path.join(os.tmpdir(), `peach_wan2_${ts}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const clipPaths: string[] = [];
  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const graph = buildWanAnimate2Graph({
        referenceImageName: refName,
        drivingVideoName: driveName,
        positive,
        negative,
        posePrompt,
        width,
        height,
        length: seg.length,
        fps,
        frameLoadCap: seg.length,
        skipFirstFrames: seg.skip,
        filenamePrefix: `${prefix}_s${i}`,
      });
      const out = await runComfyJob(
        graph,
        `peach-wan-animate2-s${i}`,
        1_800_000,
      );
      const p = path.join(tmpDir, `seg_${i}.mp4`);
      fs.writeFileSync(p, out.bytes);
      clipPaths.push(p);
    }
    const outPath = path.join(tmpDir, "out.mp4");
    await concatMp4sLossless({ clipPaths, outPath });
    const bytes = fs.readFileSync(outPath);
    return {
      bytes,
      engine: `wan_animate_2_int8+lightx2v×${segments.length}`,
      width,
      height,
      frameCount: totalFrames,
      fps,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function runWanAnimate2FromUrls(opts: {
  referenceImageUrl: string;
  drivingVideoUrl: string;
  positive?: string;
  negative?: string;
  posePrompt?: string;
  width?: number;
  height?: number;
  frameCount?: number;
  fps?: number;
  filenamePrefix?: string;
  /** When true (default), ignore stored size/length and match still + drive. */
  autoFit?: boolean;
}) {
  const ref = localBytesFromResultUrl(opts.referenceImageUrl);
  const drive = localBytesFromResultUrl(opts.drivingVideoUrl);
  if (!ref?.length) throw new Error("Не найдено reference-фото на диске");
  if (!drive?.length) throw new Error("Не найдено driving-видео на диске");
  const auto = opts.autoFit !== false;
  return runWanAnimate2Motion({
    referenceImageBytes: ref,
    drivingVideoBytes: drive,
    positive: opts.positive,
    negative: opts.negative,
    posePrompt: opts.posePrompt,
    width: auto ? undefined : opts.width,
    height: auto ? undefined : opts.height,
    frameCount: auto ? undefined : opts.frameCount,
    fps: auto ? undefined : opts.fps,
    filenamePrefix: opts.filenamePrefix,
  });
}
