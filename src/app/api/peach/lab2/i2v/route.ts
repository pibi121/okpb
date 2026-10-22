import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { labAccess } from "@/lib/ops/roles";
import { saveGalleryBinary } from "@/lib/local-store";
import { enqueueAnimateJob } from "@/lib/gallery-jobs";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";
import { clampDurationSec } from "@/lib/video-graphs";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;

async function assertLab() {
  const user = await requireUser();
  if (!user) {
    return { error: NextResponse.json({ error: "auth" }, { status: 401 }) };
  }
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  if (!labAccess(row?.adminRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}

/** Lab 2.0: uploaded photo is the I2V first frame. No template, no Identity Edit. */
export async function POST(req: NextRequest) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;
  const user = gate.user;
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const form = await req.formData();
    const prompt = String(form.get("prompt") || "").trim();
    const durationSec = clampDurationSec(Number(form.get("durationSec")));
    const photo = form.get("photo");
    if (prompt.length < 2) {
      return NextResponse.json({ error: "Нужен промпт движения" }, { status: 400 });
    }
    if (prompt.length > 8000) {
      return NextResponse.json({ error: "Промпт длиннее 8000 символов" }, { status: 400 });
    }
    if (!photo || typeof photo !== "object" || !("arrayBuffer" in photo)) {
      return NextResponse.json({ error: "Нужно одно фото" }, { status: 400 });
    }
    const file = photo as File;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Фото больше 12 МБ" }, { status: 400 });
    }
    const type = (file.type || "").toLowerCase();
    if (type && !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(type)) {
      return NextResponse.json(
        { error: "Нужен JPG, PNG или WEBP" },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 32) {
      return NextResponse.json({ error: "Файл пустой" }, { status: 400 });
    }
    const meta = await sharp(bytes).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (width < 64 || height < 64) {
      return NextResponse.json({ error: "Слишком маленькое фото" }, { status: 400 });
    }

    const ext =
      meta.format === "jpeg" ? "jpg" : meta.format === "webp" ? "webp" : "png";
    const saved = saveGalleryBinary(user.id, ext, bytes, "lab2_i2v_frame");
    const still = await prisma.galleryItem.create({
      data: {
        userId: user.id,
        kind: "photo",
        title: "Первый кадр I2V",
        prompt,
        resultUrl: saved.publicUrl,
        width,
        height,
        metaJson: JSON.stringify({
          status: "ready",
          localKey: saved.relKey,
          source: "lab2_raw_i2v",
          jobAction: "raw_i2v_still",
          durationSec,
        }),
      },
    });

    const item = await enqueueAnimateJob(
      user.id,
      still.id,
      prompt,
      false,
      prompt,
      durationSec,
    );
    return NextResponse.json({ item, stillId: still.id, durationSec });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
