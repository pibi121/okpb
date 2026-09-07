import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueuePhotoJob } from "@/lib/gallery-jobs";
import { getTgPhotoTemplateForGeneration } from "@/lib/tg-photo-template-lab";
import type { PhotoManualSlot } from "@/lib/photo-refs-shared";
import { kreaStillSize } from "@/lib/video-orientation";

export const runtime = "nodejs";
export const maxDuration = 900;

function extFromName(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "png";
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const form = await req.formData();
  const tgPhotoTemplateId = String(form.get("tgPhotoTemplateId") || "").trim();
  const characterId = String(form.get("characterId") || "").trim();
  const faceFile = form.get("facePhoto");
  const orientationId = String(form.get("orientationId") || "9_16");

  if (!tgPhotoTemplateId) {
    return NextResponse.json({ error: "Выбери шаблон" }, { status: 400 });
  }

  const tpl = await getTgPhotoTemplateForGeneration(tgPhotoTemplateId);
  if (!tpl) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }

  const manualSlots: PhotoManualSlot[] = [];
  const characterIds: string[] = [];

  if (faceFile instanceof File && faceFile.size > 0) {
    manualSlots.push({
      pictureIndex: 1,
      role: "identity",
      label: "face",
      bytes: Buffer.from(await faceFile.arrayBuffer()),
      ext: extFromName(faceFile.name || "face.png"),
    });
  } else if (characterId) {
    characterIds.push(characterId);
  } else {
    return NextResponse.json(
      { error: "Загрузи фото лица или выбери персонажа" },
      { status: 400 },
    );
  }

  const size = kreaStillSize(
    orientationId === "16_9" || orientationId === "1_1" || orientationId === "9_16"
      ? orientationId
      : "9_16",
  );

  const { composePhotoTemplatePromptForCharacter } = await import(
    "@/lib/tg/template-prompt"
  );
  const composedPrompt = await composePhotoTemplatePromptForCharacter({
    templateEditPrompt: tpl.editPrompt,
    characterIds,
    // Face upload / character dual-ref — scene text only.
    sceneOnly: true,
  });

  const item = await enqueuePhotoJob(user.id, {
    userId: user.id,
    tgPhotoTemplateId,
    characterIds,
    characterId: characterIds[0] || null,
    composedPrompt,
    manualSlots: manualSlots.length ? manualSlots : undefined,
    useIdentityDualRef: true,
    title: `TG: ${tpl.title}`,
    width: size.width,
    height: size.height,
    orientationId,
  });

  return NextResponse.json({ item });
}
