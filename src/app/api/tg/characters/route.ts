import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  addCharacterPhotoFromBuffer,
  characterPhotoCount,
  characterReadyForLoraTrain,
  createTgCharacter,
  TG_MAX_LORA_PHOTOS,
  TG_MIN_LORA_PHOTOS,
} from "@/lib/tg/character-service";
import { prisma } from "@/lib/db";
import { startLoraTrainingForUser } from "@/lib/tg/lora-onboard";
import { normalizeLocale } from "@/lib/tg/i18n";
import { TG_PREMIUM } from "@/lib/tg-pricing";
import { hasRealCharacterLora } from "@/lib/tg/studio-cast";

/** Create personal character (LoRA candidate). */
export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const ch = await createTgCharacter(userId, body.name?.trim() || "Model");
  return NextResponse.json({
    id: ch.id,
    name: ch.name,
    photoCount: 0,
    loraStatus: ch.loraStatus,
    minPhotos: TG_MIN_LORA_PHOTOS,
    maxPhotos: TG_MAX_LORA_PHOTOS,
    trainPrice: TG_PREMIUM.loraTrainPeaches,
  });
}

/** Upload LoRA training photo(s) (multipart: file or file[]). */
export async function PUT(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Bad form" }, { status: 400 });
  }

  const characterId = String(form.get("characterId") || "");
  const rawFiles = [...form.getAll("file"), ...form.getAll("files")].filter(
    (f): f is Blob =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as Blob).arrayBuffer === "function" &&
      typeof (f as Blob).size === "number" &&
      (f as Blob).size > 0,
  );

  if (!characterId || !rawFiles.length) {
    return NextResponse.json(
      { error: "characterId and file required" },
      { status: 400 },
    );
  }

  const ch = await prisma.character.findFirst({
    where: {
      id: characterId,
      userId,
      videoRefOnly: false,
      isStudioCast: false,
    },
  });
  if (!ch) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  if (ch.loraStatus === "lora_training" || ch.loraStatus === "lora_ready") {
    return NextResponse.json(
      { error: "already_training_or_ready" },
      { status: 400 },
    );
  }

  let added = 0;
  const errors: string[] = [];
  for (const file of rawFiles) {
    if (characterPhotoCount(characterId) >= TG_MAX_LORA_PHOTOS) {
      errors.push("max photos");
      break;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file instanceof File ? file.name : "upload.jpg";
    try {
      await addCharacterPhotoFromBuffer(userId, characterId, buf, name, {
        maxPhotos: TG_MAX_LORA_PHOTOS,
      });
      added += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (!added) {
    return NextResponse.json(
      { error: errors[0] || "upload failed", errors },
      { status: 400 },
    );
  }

  const count = characterPhotoCount(characterId);
  return NextResponse.json({
    ok: true,
    added,
    photoCount: count,
    readyToTrain: characterReadyForLoraTrain(characterId),
    minPhotos: TG_MIN_LORA_PHOTOS,
    maxPhotos: TG_MAX_LORA_PHOTOS,
    trainPrice: TG_PREMIUM.loraTrainPeaches,
    ...(errors.length ? { partialErrors: errors } : {}),
  });
}

/** Start LoRA training (debit + GPU). */
export async function PATCH(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    characterId?: string;
    locale?: string;
  };
  if (!body.characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }

  const locale = normalizeLocale(body.locale);
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    select: { platformUserId: true },
  });

  const result = await startLoraTrainingForUser({
    userId,
    characterId: body.characterId,
    locale,
    platformUserId: acc?.platformUserId,
  });

  if (!result.ok) {
    const status =
      result.error === "insufficient"
        ? 402
        : result.error === "not_found"
          ? 404
          : 400;
    return NextResponse.json(result, { status });
  }

  const ch = await prisma.character.findFirst({
    where: { id: body.characterId, userId },
  });
  return NextResponse.json({
    ok: true,
    loraStatus: ch?.loraStatus || "lora_training",
    loraUsable: ch ? hasRealCharacterLora(ch) : false,
    trainPrice: TG_PREMIUM.loraTrainPeaches,
  });
}
