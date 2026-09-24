import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { galleryRoot, ensureDataDirs } from "@/lib/paths";

export const runtime = "nodejs";

/**
 * Replace a file in durable TG catalog (volume).
 * Auth: Authorization: Bearer $OPS_RELEASE_NOTIFY_SECRET
 * Body: multipart form-data — filename (exact catalog name) + file
 *
 * Used for offline-blur preview swaps without SSH.
 */
export async function POST(req: Request) {
  const secret = process.env.OPS_RELEASE_NOTIFY_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "OPS_RELEASE_NOTIFY_SECRET not set" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "multipart form-data required" },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const filenameRaw = String(form.get("filename") || "").trim();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  // Only allow known catalog preview patterns — no path traversal.
  const filename = path.basename(filenameRaw);
  if (
    !/^(pt|qv|li2v)-[A-Za-z0-9_-]+\.(png|jpe?g|webp|mp4)$/i.test(filename)
  ) {
    return NextResponse.json(
      { error: "filename must be pt-|qv-|li2v- catalog asset" },
      { status: 400 },
    );
  }
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json({ error: "bad filename" }, { status: 400 });
  }

  const max = 12 * 1024 * 1024;
  if (file.size > max) {
    return NextResponse.json({ error: "file too large (12MB)" }, { status: 400 });
  }

  ensureDataDirs();
  const durableDir = path.join(galleryRoot(), "tg-catalog");
  fs.mkdirSync(durableDir, { recursive: true });
  const durablePath = path.join(durableDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(durablePath, buf);

  // Best-effort public mirror (may be read-only on Railway image).
  try {
    const pubDir = path.join(process.cwd(), "public", "tg", "catalog");
    fs.mkdirSync(pubDir, { recursive: true });
    fs.writeFileSync(path.join(pubDir, filename), buf);
  } catch {
    /* ignore */
  }

  // If this is a -preview still, also refresh matching -scene when it exists
  // (often identical twin used in publish).
  let sceneUpdated: string | null = null;
  if (/-preview\.(png|jpe?g|webp)$/i.test(filename)) {
    const sceneName = filename.replace(/-preview\./i, "-scene.");
    const scenePath = path.join(durableDir, sceneName);
    if (fs.existsSync(scenePath)) {
      fs.writeFileSync(scenePath, buf);
      sceneUpdated = sceneName;
    }
  }

  return NextResponse.json({
    ok: true,
    filename,
    bytes: buf.length,
    url: `/api/media/tg-catalog/${filename}`,
    sceneUpdated,
  });
}
