import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { saveGalleryBinary } from "@/lib/local-store";
import { prisma } from "@/lib/db";
import { updateMotionTemplate } from "@/lib/motion-templates";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Upload driving video or reference still from the user's PC into a motion template. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await prisma.motionTemplate.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const form = await req.formData();
    const kind = String(form.get("kind") || "");
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    if (kind !== "driving" && kind !== "reference") {
      return NextResponse.json(
        { error: "kind must be driving|reference" },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 100) {
      return NextResponse.json({ error: "file too small" }, { status: 400 });
    }
    if (buf.length > 120 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 120MB)" }, { status: 400 });
    }

    const name = file.name || (kind === "driving" ? "drive.mp4" : "ref.png");
    const isVideo = kind === "driving" || /\.(mp4|webm|mov)$/i.test(name);
    const ext = isVideo
      ? name.match(/\.([a-z0-9]+)$/i)?.[1] || "mp4"
      : name.match(/\.([a-z0-9]+)$/i)?.[1] || "png";

    const saved = saveGalleryBinary(
      user.id,
      ext,
      buf,
      kind === "driving" ? `motion_drive_${id}` : `motion_ref_${id}`,
    );

    await prisma.galleryItem.create({
      data: {
        userId: user.id,
        kind: isVideo ? "video" : "photo",
        title: `${existing.title} · ${kind}`,
        prompt: `motion template ${kind} upload`,
        resultUrl: saved.publicUrl,
        metaJson: JSON.stringify({
          status: "ready",
          motionTemplateId: id,
          uploadKind: kind,
          localKey: saved.relKey,
          originalName: name,
        }),
      },
    });

    const template = await updateMotionTemplate(user.id, id, {
      ...(kind === "driving" ? { drivingVideoUrl: saved.publicUrl } : {}),
      ...(kind === "reference" ? { referenceImageUrl: saved.publicUrl } : {}),
    });

    return NextResponse.json({
      ok: true,
      url: saved.publicUrl,
      template,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
