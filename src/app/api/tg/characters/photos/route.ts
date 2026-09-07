import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  addCharacterPhotoFromBuffer,
  characterPhotoCount,
  characterReadyForLoraTrain,
  TG_MAX_LORA_PHOTOS,
  TG_MIN_LORA_PHOTOS,
} from "@/lib/tg/character-service";
import {
  deleteCharacterPhoto,
  listCharacterPhotos,
} from "@/lib/character-dataset";
import { prisma } from "@/lib/db";
import { TG_PREMIUM } from "@/lib/tg-pricing";

export const runtime = "nodejs";
export const maxDuration = 120;

function parseDataUrl(dataUrl: string): { buf: Buffer; ext: string } | null {
  const m = dataUrl.match(
    /^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (!m) return null;
  const mime = (m[2] || "jpeg").toLowerCase();
  const ext = mime === "png" ? ".png" : mime === "webp" ? ".webp" : ".jpg";
  try {
    const buf = Buffer.from(m[3]!.replace(/\s/g, ""), "base64");
    if (buf.length < 64) return null;
    return { buf, ext };
  } catch {
    return null;
  }
}

async function assertOwnedDraft(userId: string, characterId: string) {
  return prisma.character.findFirst({
    where: {
      id: characterId,
      userId,
      videoRefOnly: false,
      isStudioCast: false,
    },
  });
}

/** List training photos for Mini App grid. */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const characterId = new URL(req.url).searchParams.get("characterId") || "";
  if (!characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }
  const ch = await assertOwnedDraft(userId, characterId);
  if (!ch) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const photos = listCharacterPhotos(characterId).map((p) => ({
    name: p.name,
    size: p.size,
    // Cookie session from /api/tg/auth — same-origin <img> works.
    url: `/api/characters/${characterId}/photos/${encodeURIComponent(p.name)}`,
  }));

  return NextResponse.json({
    photos,
    photoCount: photos.length,
    readyToTrain: characterReadyForLoraTrain(characterId),
    minPhotos: TG_MIN_LORA_PHOTOS,
    maxPhotos: TG_MAX_LORA_PHOTOS,
  });
}

/**
 * Upload one or more LoRA photos as JSON base64.
 * Avoids Telegram WebView FormData / multipart failures.
 */
export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    characterId?: string;
    photos?: Array<{ name?: string; dataUrl?: string }>;
    photo?: { name?: string; dataUrl?: string };
  } | null;

  if (!body?.characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }

  const items = [
    ...(body.photos || []),
    ...(body.photo ? [body.photo] : []),
  ].filter((p) => p?.dataUrl);

  if (!items.length) {
    return NextResponse.json({ error: "photos required" }, { status: 400 });
  }

  const ch = await assertOwnedDraft(userId, body.characterId);
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

  for (const item of items) {
    if (characterPhotoCount(body.characterId) >= TG_MAX_LORA_PHOTOS) {
      errors.push("max photos");
      break;
    }
    const parsed = parseDataUrl(String(item.dataUrl || ""));
    if (!parsed) {
      errors.push("bad image data");
      continue;
    }
    if (parsed.buf.length > 12 * 1024 * 1024) {
      errors.push("file too large");
      continue;
    }
    const name = (item.name || `photo${parsed.ext}`).replace(/[^\w.\-]+/g, "_");
    const fileName = /\.(jpe?g|png|webp)$/i.test(name)
      ? name
      : `${name}${parsed.ext}`;
    try {
      await addCharacterPhotoFromBuffer(
        userId,
        body.characterId,
        parsed.buf,
        fileName,
        { maxPhotos: TG_MAX_LORA_PHOTOS },
      );
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

  const photos = listCharacterPhotos(body.characterId).map((p) => ({
    name: p.name,
    url: `/api/characters/${body.characterId}/photos/${encodeURIComponent(p.name)}`,
  }));

  return NextResponse.json({
    ok: true,
    added,
    photoCount: photos.length,
    photos,
    readyToTrain: characterReadyForLoraTrain(body.characterId),
    minPhotos: TG_MIN_LORA_PHOTOS,
    maxPhotos: TG_MAX_LORA_PHOTOS,
    trainPrice: TG_PREMIUM.loraTrainPeaches,
    ...(errors.length ? { partialErrors: errors } : {}),
  });
}

/** Delete one training photo. */
export async function DELETE(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const characterId = url.searchParams.get("characterId") || "";
  const name = url.searchParams.get("name") || "";
  if (!characterId || !name) {
    return NextResponse.json(
      { error: "characterId and name required" },
      { status: 400 },
    );
  }

  const ch = await assertOwnedDraft(userId, characterId);
  if (!ch) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  if (ch.loraStatus === "lora_training" || ch.loraStatus === "lora_ready") {
    return NextResponse.json(
      { error: "already_training_or_ready" },
      { status: 400 },
    );
  }

  deleteCharacterPhoto(characterId, name);
  const photos = listCharacterPhotos(characterId);
  await prisma.character.update({
    where: { id: characterId },
    data: { photoCount: photos.length },
  });

  return NextResponse.json({
    ok: true,
    photoCount: photos.length,
    photos: photos.map((p) => ({
      name: p.name,
      url: `/api/characters/${characterId}/photos/${encodeURIComponent(p.name)}`,
    })),
    readyToTrain: characterReadyForLoraTrain(characterId),
  });
}
