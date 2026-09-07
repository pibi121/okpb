import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { enqueueMotionRun, listMotionRuns } from "@/lib/motion-templates";
import { saveGalleryBinary } from "@/lib/local-store";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const templateId = req.nextUrl.searchParams.get("templateId") || undefined;
  const runs = await listMotionRuns(user.id, templateId);
  return NextResponse.json({ runs });
}

const jsonSchema = z.object({
  templateId: z.string().min(1),
  referenceImageUrl: z.string().min(1),
  characterId: z.string().nullable().optional(),
  positivePrompt: z.string().max(4000).optional(),
  negativePrompt: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const ctype = req.headers.get("content-type") || "";
  try {
    // Multipart: templateId + optional characterId + file (reference still from PC)
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const templateId = String(form.get("templateId") || "");
      const characterId = String(form.get("characterId") || "") || null;
      const file = form.get("file");
      let referenceImageUrl = String(form.get("referenceImageUrl") || "");

      if (file instanceof File && file.size > 0) {
        const buf = Buffer.from(await file.arrayBuffer());
        const name = file.name || "ref.png";
        const ext = name.match(/\.([a-z0-9]+)$/i)?.[1] || "png";
        const saved = saveGalleryBinary(user.id, ext, buf, "motion_user_ref");
        await prisma.galleryItem.create({
          data: {
            userId: user.id,
            characterId,
            kind: "photo",
            title: "Social motion · upload",
            prompt: "user still for wan animate 2",
            resultUrl: saved.publicUrl,
            metaJson: JSON.stringify({
              status: "ready",
              localKey: saved.relKey,
              originalName: name,
              wanAnimate2: true,
            }),
          },
        });
        referenceImageUrl = saved.publicUrl;
      }

      if (!templateId || !referenceImageUrl) {
        return NextResponse.json(
          { error: "templateId и фото (file или referenceImageUrl) обязательны" },
          { status: 400 },
        );
      }

      const run = await enqueueMotionRun({
        userId: user.id,
        templateId,
        referenceImageUrl,
        characterId,
      });
      return NextResponse.json({ ok: true, run });
    }

    const body = jsonSchema.parse(await req.json());
    const run = await enqueueMotionRun({
      userId: user.id,
      templateId: body.templateId,
      referenceImageUrl: body.referenceImageUrl,
      characterId: body.characterId,
      positivePrompt: body.positivePrompt,
      negativePrompt: body.negativePrompt,
    });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
