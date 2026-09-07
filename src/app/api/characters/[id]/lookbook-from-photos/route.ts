import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inferLookbookFromPhotos } from "@/lib/lookbook-from-photos";
import {
  lookbookToEnglish,
  parseLookbook,
  preserveLookbookPromptFlags,
  type Gender,
} from "@/lib/lookbook";
import { listCharacterPhotos } from "@/lib/character-dataset";

export const runtime = "nodejs";
export const maxDuration = 600;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  const character = await prisma.character.findFirst({
    where: { id, userId: user.id },
  });
  if (!character) return NextResponse.json({ error: "not found" }, { status: 404 });

  const photos = listCharacterPhotos(id);
  if (photos.length < 1) {
    return NextResponse.json({ error: "Сначала загрузи фото" }, { status: 400 });
  }

  const gender = (character.gender === "male" ? "male" : "female") as Gender;
  try {
    const prev = parseLookbook(character.lookbookJson, gender);
    const lookbook = preserveLookbookPromptFlags(
      await inferLookbookFromPhotos({
        characterId: id,
        gender,
        name: character.name,
      }),
      prev,
      gender,
    );
    const updated = await prisma.character.update({
      where: { id },
      data: {
        lookbookJson: JSON.stringify(lookbook),
        loraStatus:
          character.loraStatus === "lookbook" ? "lookbook_ready" : character.loraStatus,
      },
    });
    return NextResponse.json({
      ok: true,
      character: updated,
      lookbook,
      preview: lookbookToEnglish(lookbook, gender),
      photosUsed: Math.min(6, photos.length),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "lookbook infer failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
