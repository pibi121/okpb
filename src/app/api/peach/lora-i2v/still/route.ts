import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enqueuePhotoJob } from "@/lib/gallery-jobs";
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

const schema = z.object({
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
    const body = schema.parse(await req.json());
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
    if (trigger && !new RegExp(`\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(composed)) {
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
