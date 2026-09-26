import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { requireUser } from "@/lib/auth";
import { applyTeaseOverlay } from "@/lib/tease-overlay-apply";
import {
  TEASE_PRESET_PATH,
  TEASE_OVERLAY_DEFAULT_FILE,
  clampTeasePreset,
  type TeaseOverlayPreset,
} from "@/lib/tease-overlay";

export const runtime = "nodejs";

function presetAbs() {
  return path.join(process.cwd(), TEASE_PRESET_PATH);
}

function overlayAbs(file: string) {
  const safe =
    file.replace(/[/\\]/g, "").slice(0, 120) || TEASE_OVERLAY_DEFAULT_FILE;
  return path.join(process.cwd(), "presets", safe);
}

function readPreset(): TeaseOverlayPreset {
  try {
    const raw = JSON.parse(
      fs.readFileSync(presetAbs(), "utf8"),
    ) as Partial<TeaseOverlayPreset>;
    return clampTeasePreset(raw);
  } catch {
    return clampTeasePreset(null);
  }
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const preset = readPreset();
  return NextResponse.json({
    preset,
    hasOverlayFile: fs.existsSync(overlayAbs(preset.overlayFile)),
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  let preset: TeaseOverlayPreset;
  let overlayBytes: Buffer | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    let parsed: Partial<TeaseOverlayPreset> = {};
    try {
      parsed = JSON.parse(
        String(form.get("preset") || "{}"),
      ) as Partial<TeaseOverlayPreset>;
    } catch {
      /* ignore */
    }
    preset = clampTeasePreset({
      ...parsed,
      updatedAt: new Date().toISOString(),
    });
    const file = form.get("overlay");
    if (file instanceof File && file.size > 0) {
      overlayBytes = Buffer.from(await file.arrayBuffer());
      preset.overlayFile = TEASE_OVERLAY_DEFAULT_FILE;
    }
  } else {
    const body = (await req.json()) as { preset?: Partial<TeaseOverlayPreset> };
    preset = clampTeasePreset({
      ...body.preset,
      updatedAt: new Date().toISOString(),
    });
  }

  fs.mkdirSync(path.join(process.cwd(), "presets"), { recursive: true });
  if (overlayBytes?.length) {
    await sharp(overlayBytes).png().toFile(overlayAbs(preset.overlayFile));
  }
  fs.writeFileSync(presetAbs(), JSON.stringify(preset, null, 2), "utf8");
  return NextResponse.json({ preset, ok: true });
}

/** Server apply = future TG tease path. Returns PNG. */
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const form = await req.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size <= 0) {
    return NextResponse.json({ error: "Нужно photo" }, { status: 400 });
  }

  let preset = readPreset();
  try {
    const raw = String(form.get("preset") || "");
    if (raw.trim()) {
      preset = clampTeasePreset(JSON.parse(raw) as Partial<TeaseOverlayPreset>);
    }
  } catch {
    /* keep */
  }

  let overlayBuf: Buffer | null = null;
  const overlayUpload = form.get("overlay");
  if (overlayUpload instanceof File && overlayUpload.size > 0) {
    overlayBuf = Buffer.from(await overlayUpload.arrayBuffer());
  } else {
    const p = overlayAbs(preset.overlayFile);
    if (fs.existsSync(p)) overlayBuf = fs.readFileSync(p);
  }

  const out = await applyTeaseOverlay(
    Buffer.from(await photo.arrayBuffer()),
    overlayBuf,
    preset,
  );
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": 'attachment; filename="tease_preview.png"',
    },
  });
}
