/**
 * Social MiniMax H3 Ref2V: appearance photos + driving video → remake clip.
 */
import {
  comfyUploadImage,
  ensureComfyReady,
  runComfyJob,
  comfyI2VTimeoutMs,
} from "@/lib/comfy-client";
import {
  extractAudioWavFromVideoBuffer,
  probeMediaBuffer,
} from "@/lib/ffmpeg-stitch";
import { useComfy } from "@/lib/metalnode-config";
import { ollamaUnload } from "@/lib/ollama-client";
import {
  buildMinimaxRef2VGraph,
  clampDurationSec,
  minimaxLengthFromSec,
  minimaxSize,
} from "@/lib/video-graphs";

export const SOCIAL_REF2V_DEFAULT_PROMPT = `Recreate the shot with the same motion, gestures, camera moves, and timing as <Video 1>.
The person must match the appearance and identity of the reference photos exactly (face, body, hair, skin).
Photorealistic, natural skin detail, same pacing as the reference video.
Audio: natural ambience matching the scene; if the reference video has speech or music energy, keep a similar mood.`;

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

export async function runSocialMinimaxRef2V(opts: {
  refImageBuffers: Buffer[];
  refImageNames?: string[];
  drivingVideoBytes: Buffer;
  drivingVideoName?: string;
  prompt?: string;
  filenamePrefix?: string;
  /** Prefer identity photos' aspect; fallback to driving video. */
  widthHint?: number;
  heightHint?: number;
}) {
  if (!opts.refImageBuffers.length) {
    throw new Error("Нужно хотя бы одно фото внешности");
  }
  if (!opts.drivingVideoBytes?.length) {
    throw new Error("Нужно исходное видео");
  }

  await ollamaUnload();
  if (!useComfy()) throw new Error("Comfy отключён");
  await ensureComfyReady(25, 2000);

  const driveNameHint = opts.drivingVideoName || "drive.mp4";
  const driveProbe = await probeMediaBuffer(
    opts.drivingVideoBytes,
    extOf(driveNameHint, ".mp4"),
  );

  let srcW = opts.widthHint || 0;
  let srcH = opts.heightHint || 0;
  if (!srcW || !srcH) {
    try {
      const imgProbe = await probeMediaBuffer(
        opts.refImageBuffers[0]!,
        extOf(opts.refImageNames?.[0] || "ref.png", ".png"),
      );
      srcW = imgProbe.width;
      srcH = imgProbe.height;
    } catch {
      srcW = driveProbe.width;
      srcH = driveProbe.height;
    }
  }

  const size = minimaxSize(srcW, srcH);
  const durationSec = clampDurationSec(
    driveProbe.duration > 0.2 ? driveProbe.duration : 6,
  );
  const length = minimaxLengthFromSec(durationSec);

  const userPrompt = (opts.prompt || "").trim();
  const prompt = userPrompt
    ? `${SOCIAL_REF2V_DEFAULT_PROMPT}\n\nExtra direction: ${userPrompt}`
    : SOCIAL_REF2V_DEFAULT_PROMPT;

  const ts = Date.now();
  const refImageNames: string[] = [];
  const maxRefs = Math.min(4, opts.refImageBuffers.length);
  for (let i = 0; i < maxRefs; i++) {
    const hint = opts.refImageNames?.[i] || `ref_${i}.png`;
    const name = await comfyUploadImage(
      `peach_social_ref2v_face_${ts}_${i}${extOf(hint, ".png")}`,
      opts.refImageBuffers[i]!,
      guessImageMime(hint),
    );
    refImageNames.push(name);
  }

  const driveUploaded = await comfyUploadImage(
    `peach_social_ref2v_drive_${ts}${extOf(driveNameHint, ".mp4")}`,
    opts.drivingVideoBytes,
    guessVideoMime(driveNameHint),
  );

  let refVideoAudioNames: string[] | undefined;
  const wav = await extractAudioWavFromVideoBuffer(opts.drivingVideoBytes, {
    maxSec: durationSec,
    ext: extOf(driveNameHint, ".mp4"),
  });
  if (wav?.length) {
    const audName = await comfyUploadImage(
      `peach_social_ref2v_drive_${ts}.wav`,
      wav,
      "audio/wav",
    );
    refVideoAudioNames = [audName];
  }

  console.log(
    `[peach] social-ref2v size=${size.width}x${size.height} length=${length} ` +
      `(~${durationSec}s) refs=${refImageNames.length} drive=${driveProbe.duration.toFixed(2)}s ` +
      `audio=${refVideoAudioNames ? "yes" : "no"}`,
  );

  const clip = await runComfyJob(
    buildMinimaxRef2VGraph({
      refImageNames,
      refVideoNames: [driveUploaded],
      refVideoAudioNames,
      prompt,
      width: size.width,
      height: size.height,
      length,
      refVideoFrameCap: length,
      filenamePrefix: opts.filenamePrefix || "peach/social-ref2v",
    }),
    "peach-social-ref2v",
    comfyI2VTimeoutMs(durationSec),
  );

  return {
    bytes: clip.bytes,
    engine: "minimax_h3_ref2v+ref_video",
    width: size.width,
    height: size.height,
    durationSec,
    length,
    prompt,
  };
}
