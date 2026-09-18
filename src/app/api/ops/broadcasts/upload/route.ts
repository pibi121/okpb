import { NextResponse } from "next/server";
import { withOps, jsonOk, jsonErr } from "@/lib/ops/http";
import { saveGalleryBinary } from "@/lib/local-store";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

export const runtime = "nodejs";

const IMAGE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 40 * 1024 * 1024;

export async function POST(req: Request) {
  return withOps("broadcasts", async () => {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return jsonErr("Нужен multipart/form-data с полем file");
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonErr("Выберите файл");
    }
    const isImage =
      IMAGE.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
    const isVideo =
      VIDEO.has(file.type) || /\.(mp4|webm|mov)$/i.test(file.name);
    if (!isImage && !isVideo) {
      return jsonErr("Только JPG / PNG / WEBP / MP4 / WEBM");
    }
    const max = isVideo ? MAX_VIDEO : MAX_IMAGE;
    if (file.size > max) {
      return jsonErr(isVideo ? "Видео больше 40 МБ" : "Файл больше 8 МБ");
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = isVideo
      ? file.type.includes("webm") || /\.webm$/i.test(file.name)
        ? "webm"
        : "mp4"
      : file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const saved = saveGalleryBinary("_ops", ext, buf, "broadcast");
    const absolute = `${publicSiteBaseUrl()}${saved.publicUrl}`;
    return jsonOk({
      mediaUrl: absolute,
      publicUrl: saved.publicUrl,
      type: isVideo ? "video" : "photo",
      bytes: buf.length,
    });
  });
}
