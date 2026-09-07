import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  addCharacterPhotoFromBuffer,
  characterPhotoCount,
  characterReadyForVideo,
  createVideoRefCharacter,
  listVideoRefCharacters,
  TG_MAX_CHARACTER_PHOTOS,
} from "@/lib/tg/character-service";
import { prisma } from "@/lib/db";

/** List user's saved video-ref characters (🎬). */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await listVideoRefCharacters(userId);
  return NextResponse.json({
    refs: rows.map((c) => ({
      id: c.id,
      name: c.name,
      photoCount: c.photoCount,
      ready: characterReadyForVideo(c.id),
    })),
  });
}

/** Create empty video-ref character slot for uploads. */
export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const ch = await createVideoRefCharacter(userId, body.name?.trim() || "Модель");
  return NextResponse.json({ id: ch.id, name: ch.name });
}

/** Upload identity ref photo (multipart). */
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
  const file = form.get("file");
  if (!characterId || !(file instanceof Blob)) {
    return NextResponse.json({ error: "characterId and file required" }, { status: 400 });
  }

  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId, videoRefOnly: true },
  });
  if (!ch) {
    return NextResponse.json({ error: "Video ref not found" }, { status: 404 });
  }

  if (characterPhotoCount(characterId) >= TG_MAX_CHARACTER_PHOTOS) {
    return NextResponse.json({ error: "max photos" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file instanceof File ? file.name : "upload.jpg";
  await addCharacterPhotoFromBuffer(userId, characterId, buf, name);

  const count = characterPhotoCount(characterId);
  return NextResponse.json({
    ok: true,
    photoCount: count,
    ready: characterReadyForVideo(characterId),
  });
}
