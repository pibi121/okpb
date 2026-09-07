import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { parseLookbook, type LookbookValues } from "@/lib/lookbook";

const patchSchema = z.object({
  characterId: z.string().min(1),
  lookbook: z.record(z.string(), z.string()),
});

/** GET lookbook for a personal TG character. */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const characterId = url.searchParams.get("characterId") || "";
  if (!characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }

  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId, isStudioCast: false },
    select: { id: true, name: true, gender: true, lookbookJson: true, loraStatus: true },
  });
  if (!ch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const gender = ch.gender === "male" ? "male" : "female";
  return NextResponse.json({
    characterId: ch.id,
    name: ch.name,
    gender,
    loraStatus: ch.loraStatus,
    lookbook: parseLookbook(ch.lookbookJson, gender),
  });
}

/** PATCH body lookbook fields for a personal TG character. */
export async function PATCH(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const ch = await prisma.character.findFirst({
    where: {
      id: parsed.data.characterId,
      userId,
      isStudioCast: false,
    },
  });
  if (!ch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const gender = ch.gender === "male" ? "male" : "female";
  const prev = parseLookbook(ch.lookbookJson, gender);
  const next: LookbookValues = { ...prev, ...parsed.data.lookbook };

  await prisma.character.update({
    where: { id: ch.id },
    data: { lookbookJson: JSON.stringify(next) },
  });

  return NextResponse.json({ ok: true, lookbook: next });
}
