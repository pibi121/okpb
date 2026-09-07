import { NextResponse } from "next/server";
import { withOps, jsonOk, jsonErr } from "@/lib/ops/http";
import { saveGalleryBinary } from "@/lib/local-store";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

export const runtime = "nodejs";

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  return withOps("broadcasts", async () => {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return jsonErr("Нужен multipart/form-data с полем file");
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonErr("Выберите файл изображения");
    }
    if (!ALLOWED.has(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      return jsonErr("Только JPG / PNG / WEBP");
    }
    if (file.size > MAX_BYTES) {
      return jsonErr("Файл больше 8 МБ");
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const saved = saveGalleryBinary("_ops", ext, buf, "broadcast");
    const absolute = `${publicSiteBaseUrl()}${saved.publicUrl}`;
    return jsonOk({
      mediaUrl: absolute,
      publicUrl: saved.publicUrl,
      bytes: buf.length,
    });
  });
}
