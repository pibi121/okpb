/**
 * H3 IMAGE_EDIT undress runner for TG.
 * Always /free before (and on black-frame retry) to avoid NaN after video jobs.
 */
import fs from "node:fs";
import path from "node:path";
import {
  comfyFreeMemory,
  comfyUploadImage,
  runComfyAndDownload,
  COMFY_PHOTO_TIMEOUT_MS,
} from "@/lib/comfy-client";

const UNDRESS_PROMPT =
  "completely nude, naked, bare breasts, bare skin, remove all clothes. Keep the exact same face, hair, body proportions, pose, camera angle, and location/background from Picture 1. Photorealistic natural skin.";

function loadUndressGraph(): Record<string, unknown> {
  const p = path.join(process.cwd(), "workflows", "peach_H3_UNDRESS_API.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

function isNearBlackPng(buf: Buffer): boolean {
  // PNG IHDR is 16 bytes after 8-byte signature; rough: tiny files or all-zero samples.
  if (buf.length < 8_000) return true;
  // Sample a few bytes in IDAT-ish region — if many zeros in mid file, likely black.
  let zeros = 0;
  const start = Math.min(buf.length - 1, 2_000);
  const end = Math.min(buf.length, start + 4_000);
  for (let i = start; i < end; i++) {
    if (buf[i] === 0) zeros += 1;
  }
  return zeros / Math.max(1, end - start) > 0.92;
}

export async function runH3UndressBytes(input: Buffer): Promise<Buffer> {
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

  const buildGraph = () => {
    const graph = loadUndressGraph();
    const load = graph["0"] as { inputs?: Record<string, unknown> };
    if (load?.inputs) load.inputs.image = uploaded;
    const prep = graph["5"] as { inputs?: Record<string, unknown> };
    if (prep?.inputs) prep.inputs.edit_instruction = UNDRESS_PROMPT;
    const noise = graph["6"] as { inputs?: Record<string, unknown> };
    if (noise?.inputs) {
      noise.inputs.noise_seed = Math.floor(Math.random() * 2_147_483_647);
    }
    return graph;
  };

  await comfyFreeMemory();
  let bytes = await runComfyAndDownload(
    buildGraph(),
    "peach-undress",
    COMFY_PHOTO_TIMEOUT_MS,
  );

  if (isNearBlackPng(bytes)) {
    console.warn("[undress] near-black output — free + retry once");
    await comfyFreeMemory();
    bytes = await runComfyAndDownload(
      buildGraph(),
      "peach-undress-retry",
      COMFY_PHOTO_TIMEOUT_MS,
    );
  }

  if (isNearBlackPng(bytes)) {
    throw new Error("undress_black_frame");
  }
  return bytes;
}
