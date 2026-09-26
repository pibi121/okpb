import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enqueuePhotoJob } from "@/lib/gallery-jobs";
import { enqueuePhotoEditLabJob } from "@/lib/photo-edit-lab";
import { kreaStillSize } from "@/lib/video-orientation";

export const runtime = "nodejs";
export const maxDuration = 900;

function usableLora(ch: {
  loraStatus: string;
  triggerWord: string | null;
  loraPath: string | null;
}) {
  if (ch.loraStatus !== "lora_ready" || !ch.triggerWord) return false;
  const path = ch.loraPath || "";
  if (path && !path.startsWith("mock://")) return true;
  return ch.triggerWord === "olh_person";
}

const jsonSchema = z.object({
  characterId: z.string().min(1),
  stillPrompt: z.string().min(2).max(8000),
  negativePrompt: z.string().max(2000).optional(),
  orientationId: z.enum(["9_16", "16_9", "1_1"]).optional(),
  title: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const contentType = req.headers.get("content-type") || "";

    // Lab 2.0: one-photo Identity Edit still (no LoRA character)
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const stillPrompt = String(form.get("stillPrompt") || "").trim();
      const title = String(form.get("title") || "").trim();
      const photo = form.get("photo");
      if (stillPrompt.length < 2) {
        return NextResponse.json({ error: "Нужен still-промпт" }, { status: 400 });
      }
      if (!photo || typeof photo !== "object" || !("arrayBuffer" in photo)) {
        return NextResponse.json(
          { error: "Нужно фото для Identity Edit" },
          { status: 400 },
        );
      }
      const file = photo as File;
      const photoBytes = Buffer.from(await file.arrayBuffer());
      const { galleryItemId } = await enqueuePhotoEditLabJob({
        userId: user.id,
        photoBytes,
        editPrompt: stillPrompt,
        useUndressStack: true,
        title: title || "I2V still · 1 photo",
      });
      const item = await prisma.galleryItem.findUnique({
        where: { id: galleryItemId },
      });
      return NextResponse.json({ item, galleryItemId, mode: "one_photo" });
    }

    const body = jsonSchema.parse(await req.json());
    const ch = await prisma.character.findFirst({
      where: {
        id: body.characterId,
        OR: [{ userId: user.id }, { isStudioCast: true }],
      },
    });
    if (!ch) {
      return NextResponse.json({ error: "Персонаж не найден" }, { status: 404 });
    }
    if (!usableLora(ch)) {
      return NextResponse.json(
        { error: "Нужен персонаж с обученной LoRA (lora_ready)" },
        { status: 400 },
      );
    }

    const orient = body.orientationId || "9_16";
    const size = kreaStillSize(orient);
    const trigger = ch.triggerWord?.trim();
    let composed = body.stillPrompt.trim();
    if (
      trigger &&
      !new RegExp(
        `\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(composed)
    ) {
      composed = `${trigger}, ${composed}`;
    }

    const item = await enqueuePhotoJob(user.id, {
      userId: user.id,
      characterId: ch.id,
      characterIds: [ch.id],
      useCharacterLora: true,
      usePreset: false,
      composedPrompt: composed,
      negativePrompt: body.negativePrompt?.trim() || undefined,
      title: body.title?.trim() || `LoRA→I2V still · ${ch.name}`,
      width: size.width,
      height: size.height,
      orientationId: orient,
    });

    return NextResponse.json({ item });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
