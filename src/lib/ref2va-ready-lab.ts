/**
 * Run MiniMax_H3_Character_Ref2VA_READY Comfy workflow (SAM3 + in-scene swap).
 */
import {
  comfyI2VTimeoutMs,
  comfyUploadImage,
  ensureComfyReady,
  runComfyJob,
} from "@/lib/comfy-client";
import {
  loadRef2VAReadyApiWorkflow,
  patchRef2VAReadyPrompt,
} from "@/lib/ref2va-ready-graph";
import { useComfy } from "@/lib/metalnode-config";
import { ollamaUnload } from "@/lib/ollama-client";
import { probeMediaBuffer } from "@/lib/ffmpeg-stitch";
import { clampDurationSec } from "@/lib/video-graphs";
import {
  minimaxOutputSize,
  type SocialOrientationId,
} from "@/lib/video-orientation";

const DEFAULT_SCENE =
  "Preserve the scene, background, lighting, composition, camera angle and camera movement from <Video 1>. Keep the spatial layout and timing consistent with the source video.";
const DEFAULT_MOTION =
  "Preserve the action, pose changes, gestures and timing from <Video 1> as closely as possible. Keep natural motion and temporal consistency.";

export type Ref2VAOrientation = SocialOrientationId;

function guessImageMime(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function guessVideoMime(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

function extOf(name: string, fallback: string) {
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : fallback;
}

export async function runCharacterRef2VAReady(opts: {
  characterPhotoBytes: Buffer;
  characterPhotoName?: string;
  drivingVideoBytes: Buffer;
  drivingVideoName?: string;
  scenePrompt?: string;
  motionPrompt?: string;
  sam3Target?: string;
  durationSec?: number;
  seed?: number;
  filenamePrefix: string;
  /** Default match_photo — output follows Krea still aspect */
  orientation?: Ref2VAOrientation;
  photoWidth?: number;
  photoHeight?: number;
}) {
  if (!opts.characterPhotoBytes?.length) {
    throw new Error("Нет фото персонажа для Ref2VA");
  }
  if (!opts.drivingVideoBytes?.length) {
    throw new Error("Нет исходного видео шаблона");
  }

  await ollamaUnload();
  if (!useComfy()) throw new Error("Comfy отключён");
  await ensureComfyReady(25, 2000);

  const driveName = opts.drivingVideoName || "template.mp4";
  const probe = await probeMediaBuffer(
    opts.drivingVideoBytes,
    extOf(driveName, ".mp4"),
  );
  const durationSec = clampDurationSec(
    opts.durationSec || (probe.duration > 0.2 ? probe.duration : 10),
  );

  let photoW = opts.photoWidth || 0;
  let photoH = opts.photoHeight || 0;
  if (!photoW || !photoH) {
    try {
      const photoProbe = await probeMediaBuffer(
        opts.characterPhotoBytes,
        extOf(opts.characterPhotoName || ".png", ".png"),
      );
      photoW = photoProbe.width || photoW;
      photoH = photoProbe.height || photoH;
    } catch {
      /* keep defaults */
    }
  }

  const size = minimaxOutputSize(opts.orientation || "match_photo", {
    photoW: photoW || 888,
    photoH: photoH || 1176,
    videoW: probe.width || 0,
    videoH: probe.height || 0,
  });

  const ts = Date.now();
  const charName = await comfyUploadImage(
    `peach_ref2va_char_${ts}${extOf(opts.characterPhotoName || ".png", ".png")}`,
    opts.characterPhotoBytes,
    guessImageMime(opts.characterPhotoName || "char.png"),
  );
  const videoName = await comfyUploadImage(
    `peach_ref2va_drive_${ts}${extOf(driveName, ".mp4")}`,
    opts.drivingVideoBytes,
    guessVideoMime(driveName),
  );

  const base = loadRef2VAReadyApiWorkflow();
  const graph = patchRef2VAReadyPrompt(base, {
    characterImageName: charName,
    drivingVideoName: videoName,
    scenePrompt: opts.scenePrompt?.trim() || DEFAULT_SCENE,
    motionPrompt: opts.motionPrompt?.trim() || DEFAULT_MOTION,
    sam3Target: opts.sam3Target || "The woman",
    durationSec,
    seed: opts.seed,
    filenamePrefix: opts.filenamePrefix,
    width: size.width,
    height: size.height,
  });

  console.log(
    `[peach] ref2va-ready duration=${durationSec}s drive=${probe.duration.toFixed(1)}s ` +
      `size=${size.width}x${size.height} orient=${opts.orientation || "match_photo"}`,
  );

  const clip = await runComfyJob(
    graph.prompt,
    "peach-ref2va-ready",
    comfyI2VTimeoutMs(durationSec),
    graph.definitions,
  );

  return {
    bytes: clip.bytes,
    engine: "minimax_h3_ref2va_ready+sam3",
    durationSec,
    width: size.width,
    height: size.height,
  };
}
