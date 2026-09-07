import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  deleteLoraI2vTemplate,
  getLoraI2vTemplate,
  updateLoraI2vTemplate,
} from "@/lib/lora-i2v-template";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const template = await getLoraI2vTemplate(user.id, id);
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ template });
}

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  notes: z.string().max(500).optional(),
  titleEn: z.string().max(120).optional(),
  notesEn: z.string().max(500).optional(),
  stillPrompt: z.string().min(1).max(8000).optional(),
  i2vPrompt: z.string().min(1).max(8000).optional(),
  negativePrompt: z.string().max(2000).optional(),
  orientation: z.string().max(16).optional(),
  durationSec: z.number().int().min(4).max(12).optional(),
  pricePeaches: z.number().int().min(0).max(99999).optional(),
  sceneCategory: z.string().max(120).optional(),
  previewImageUrl: z.string().max(2000).optional(),
  previewVideoUrl: z.string().max(2000).optional(),
  sourceStillId: z.string().max(64).optional(),
  sourceVideoId: z.string().max(64).optional(),
  published: z.boolean().optional(),
  characterId: z.string().max(64).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = patchSchema.parse(await req.json());
    let scrub: { triggerWord?: string | null; characterName?: string | null } |
      undefined;
    if (body.characterId) {
      const ch = await prisma.character.findFirst({
        where: {
          id: body.characterId,
          OR: [{ userId: user.id }, { isStudioCast: true }],
        },
        select: { triggerWord: true, name: true },
      });
      if (ch) scrub = { triggerWord: ch.triggerWord, characterName: ch.name };
    }
    const { characterId: _c, ...rest } = body;
    void _c;
    const template = await updateLoraI2vTemplate(user.id, id, {
      ...rest,
      scrub,
    });
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await deleteLoraI2vTemplate(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
