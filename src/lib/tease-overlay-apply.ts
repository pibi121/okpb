import sharp from "sharp";
import {
  clampTeasePreset,
  teaseBlurSigma,
  type TeaseOverlayPreset,
} from "@/lib/tease-overlay";

/** Apply tease blur + PNG overlay (server / TG path). */
export async function applyTeaseOverlay(
  photoBytes: Buffer,
  overlayBytes: Buffer | null,
  presetIn: Partial<TeaseOverlayPreset>,
): Promise<Buffer> {
  const preset = clampTeasePreset(presetIn);
  const meta = await sharp(photoBytes).rotate().metadata();
  const w = meta.width || 888;
  const h = meta.height || 1176;

  let pipeline = sharp(photoBytes).rotate();
  if (preset.blurPx > 0.5) {
    pipeline = pipeline.blur(teaseBlurSigma(preset.blurPx));
  }

  if (!overlayBytes?.length) {
    return pipeline.png().toBuffer();
  }

  const ovMeta = await sharp(overlayBytes).metadata();
  const targetW = Math.max(
    32,
    Math.round(Math.min(w, h) * preset.overlayScale),
  );
  const ow = Math.max(1, ovMeta.width || targetW);
  const oh = Math.max(1, ovMeta.height || targetW);
  const targetH = Math.max(32, Math.round((oh * targetW) / ow));

  const { data, info } = await sharp(overlayBytes)
    .resize(targetW, targetH, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const opacity = preset.overlayOpacity;
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round((data[i] ?? 0) * opacity);
  }

  const left = Math.round(preset.overlayX * w - info.width / 2);
  const top = Math.round(preset.overlayY * h - info.height / 2);

  return pipeline
    .composite([
      {
        input: Buffer.from(data),
        raw: {
          width: info.width,
          height: info.height,
          channels: 4,
        },
        left: Math.max(0, Math.min(Math.max(0, w - info.width), left)),
        top: Math.max(0, Math.min(Math.max(0, h - info.height), top)),
      },
    ])
    .png()
    .toBuffer();
}
