import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labAccess } from "@/lib/ops/roles";
import { saveGalleryBinary } from "@/lib/local-store";
import { copyAssetToTgCatalog } from "@/lib/tg/tg-publish";

export const runtime = "nodejs";
export const maxDuration = 120;

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

/** Upload preview image/video for Lab 2.0 transfer UI. */
export async function POST(req: NextRequest) {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;
  const user = gate.user!;

  const form = await req.formData();
  const kind = String(form.get("kind") || "").trim();
  const id = String(form.get("id") || "").trim();
  const slot = String(form.get("slot") || "image").trim(); // image | video
  const file = form.get("file");

  if (!["photo", "video", "lora_i2v"].includes(kind) || !id) {
    return NextResponse.json({ error: "kind/id" }, { status: 400 });
  }
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "file" }, { status: 400 });
  }

  const f = file as File;
  const bytes = Buffer.from(await f.arrayBuffer());
  if (!bytes.length) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  const ext =
    (f.name || (slot === "video" ? "teaser.mp4" : "preview.jpg"))
      .split(".")
      .pop()
      ?.toLowerCase() || (slot === "video" ? "mp4" : "jpg");

  const saved = saveGalleryBinary(
    user.id,
    ext,
    bytes,
    `lab2_${kind}_${slot}`,
  );
  const slug = `lab2-${kind}-${id.slice(0, 10)}-${slot}`;
  const catalogUrl =
    copyAssetToTgCatalog(
      saved.publicUrl,
      slug,
      slot === "video" ? ".mp4" : ".jpg",
    ) || saved.publicUrl;

  if (kind === "photo") {
    const data =
      slot === "video"
        ? { previewVideoUrl: catalogUrl }
        : { previewImageUrl: catalogUrl };
    await prisma.photoTemplate.update({ where: { id }, data });
  } else if (kind === "video") {
    const data =
      slot === "video"
        ? { previewVideoUrl: catalogUrl }
        : { previewPhotoUrl: catalogUrl };
    await prisma.quickVideoTemplate.update({ where: { id }, data });
  } else {
    const data =
      slot === "video"
        ? { previewVideoUrl: catalogUrl }
        : { previewImageUrl: catalogUrl };
    await prisma.loraI2vTemplate.update({ where: { id }, data });
  }

  return NextResponse.json({
    ok: true,
    url: catalogUrl,
    slot,
    kind,
    id,
  });
}
