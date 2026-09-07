/** Client-side image normalize for TG Mini App LoRA uploads (esp. iOS HEIC). */

const IMAGE_NAME_RE = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i;

export function isLikelyImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  if (IMAGE_NAME_RE.test(file.name || "")) return true;
  // iOS/Telegram often gives empty MIME for Photos library picks.
  if (!file.type || file.type === "application/octet-stream") {
    return file.size > 0;
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function canvasToJpegDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("jpeg encode failed");
  const dataUrl = await readAsDataUrl(blob);
  if (!/^data:image\/jpeg/i.test(dataUrl)) throw new Error("not jpeg");
  return dataUrl;
}

/** iOS Safari/Telegram: HEIC often decodes via <img>, not createImageBitmap. */
async function decodeViaHtmlImage(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await withTimeout(
      new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image load failed"));
        el.src = url;
      }),
      12000,
      "image timeout",
    );
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("empty image");
    return canvasToJpegDataUrl(img, w, h, maxEdge, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeViaBitmap(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const bitmap = await withTimeout(
    createImageBitmap(file),
    8000,
    "bitmap timeout",
  );
  try {
    return await canvasToJpegDataUrl(
      bitmap,
      bitmap.width,
      bitmap.height,
      maxEdge,
      quality,
    );
  } finally {
    bitmap.close();
  }
}

/** Decode phone/Telegram image → JPEG data URL (never send raw HEIC). */
export async function fileToJpegDataUrl(
  file: File,
  opts?: { maxEdge?: number; quality?: number },
): Promise<string> {
  const maxEdge = opts?.maxEdge ?? 1280;
  const quality = opts?.quality ?? 0.82;

  if (
    (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) &&
    file.size < 1_800_000
  ) {
    const raw = await readAsDataUrl(file);
    if (/^data:image\/jpeg/i.test(raw)) return raw;
  }

  // HTMLImage first — most reliable for iOS HEIC in Telegram WebView.
  try {
    return await decodeViaHtmlImage(file, maxEdge, quality);
  } catch {
    /* fall through */
  }

  try {
    return await decodeViaBitmap(file, maxEdge, quality);
  } catch {
    /* fall through */
  }

  // Already PNG/WebP — re-encode via Image if possible, else pass through if JPEG-compatible.
  if (file.type === "image/png" || file.type === "image/webp") {
    try {
      return await decodeViaHtmlImage(file, maxEdge, quality);
    } catch {
      const raw = await readAsDataUrl(file);
      if (/^data:image\/(png|webp|jpeg)/i.test(raw)) return raw;
    }
  }

  throw new Error("decode failed");
}

export async function filesToJpegDataUrls(
  files: File[],
): Promise<{
  ok: Array<{ name: string; dataUrl: string }>;
  failed: number;
}> {
  const ok: Array<{ name: string; dataUrl: string }> = [];
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (!isLikelyImageFile(file) && file.size <= 0) {
      failed += 1;
      continue;
    }
    try {
      const dataUrl = await fileToJpegDataUrl(file);
      ok.push({ name: `photo-${i + 1}.jpg`, dataUrl });
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}
