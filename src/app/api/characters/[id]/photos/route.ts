import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteCharacterPhoto,
  listCharacterPhotos,
  saveCharacterPhoto,
} from "@/lib/character-dataset";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ photos: listCharacterPhotos(id) });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const single = form.get("file");
  if (single instanceof File) files.push(single);
  if (!files.length) {
    return NextResponse.json({ error: "нет файлов (field: files)" }, { status: 400 });
  }

  const existing = listCharacterPhotos(id);
  if (existing.length + files.length > 50) {
    return NextResponse.json({ error: "макс. 50 фото" }, { status: 400 });
  }

  const saved: string[] = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 100) continue;
    if (buf.length > 25 * 1024 * 1024) {
      return NextResponse.json({ error: `${file.name}: слишком большой файл` }, { status: 400 });
    }
    saved.push(saveCharacterPhoto(id, file.name || "photo.png", buf, ch.triggerWord));
  }

  const photos = listCharacterPhotos(id);
  await prisma.character.update({
    where: { id },
    data: { photoCount: photos.length },
  });

  return NextResponse.json({ saved, photos });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  deleteCharacterPhoto(id, name);
  const photos = listCharacterPhotos(id);
  await prisma.character.update({
    where: { id },
    data: { photoCount: photos.length },
  });
  return NextResponse.json({ photos });
}
