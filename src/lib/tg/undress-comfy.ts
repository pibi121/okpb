/**
 * TG undress: Krea2 Identity Edit + Projector(0.01) + Realism Engine v3.1
 * (same stack as workflows/krea2_edit_projector_realism_LAB.json).
 * Metalnode only — Projector/Realism weights are not on RunPod yet.
 */
import {
  comfyFreeMemory,
  comfyUploadImage,
  runComfyAndDownload,
  COMFY_PHOTO_TIMEOUT_MS,
} from "@/lib/comfy-client";
import {
  buildKreaEditGraph,
  KREA_UNDRESS_EXTRA_LORAS,
  KREA_UNDRESS_PROMPT,
} from "@/lib/krea-graphs";

function isNearBlackPng(buf: Buffer): boolean {
  if (buf.length < 8_000) return true;
  let zeros = 0;
  const start = Math.min(buf.length - 1, 2_000);
  const end = Math.min(buf.length, start + 4_000);
  for (let i = start; i < end; i++) {
    if (buf[i] === 0) zeros += 1;
  }
  return zeros / Math.max(1, end - start) > 0.92;
}

/** Read PNG/JPEG dimensions without sharp. */
export function undressImageSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG — scan for SOF0/SOF2
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const len = buf.readUInt16BE(i + 2);
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      }
      i += 2 + len;
    }
  }
  return { width: 888, height: 1176 };
}

/** Snap to multiple of 8; keep ~1MP sweet spot for Identity Edit. */
export function undressLatentSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const w0 = Math.max(64, width || 888);
  const h0 = Math.max(64, height || 1176);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const round8 = (n: number) => Math.max(64, Math.round((n * scale) / 8) * 8);
  return { width: round8(w0), height: round8(h0) };
}

export async function runUndressBytes(input: Buffer): Promise<Buffer> {
  const isJpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8;
  const isPng =
    input.length >= 8 &&
    input[0] === 0x89 &&
    input[1] === 0x50 &&
    input[2] === 0x4e &&
    input[3] === 0x47;
  const ext = isJpeg ? "jpg" : isPng ? "png" : "jpg";
  const mime = isJpeg ? "image/jpeg" : isPng ? "image/png" : "image/jpeg";
  const uploaded = await comfyUploadImage(
    `undress_${Date.now()}.${ext}`,
    input,
    mime,
  );

  const raw = undressImageSize(input);
  const { width, height } = undressLatentSize(raw.width, raw.height);

  const buildGraph = () =>
    buildKreaEditGraph({
      imageName: uploaded,
      editPrompt: KREA_UNDRESS_PROMPT,
      width,
      height,
      seed: Math.floor(Math.random() * 1e15),
      extraModelLoras: KREA_UNDRESS_EXTRA_LORAS,
      filenamePrefix: "peach/undress_krea",
    });

  await comfyFreeMemory();
  let bytes = await runComfyAndDownload(
    buildGraph(),
    "peach-undress-krea",
    COMFY_PHOTO_TIMEOUT_MS,
  );

  if (isNearBlackPng(bytes)) {
    console.warn("[undress] near-black output — free + retry once");
    await comfyFreeMemory();
    bytes = await runComfyAndDownload(
      buildGraph(),
      "peach-undress-krea-retry",
      COMFY_PHOTO_TIMEOUT_MS,
    );
  }

  if (isNearBlackPng(bytes)) {
    throw new Error("undress_black_frame");
  }
  return bytes;
}

/** @deprecated alias — old name from H3 undress path */
export const runH3UndressBytes = runUndressBytes;
