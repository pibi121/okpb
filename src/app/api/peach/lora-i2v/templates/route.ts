import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createLoraI2vTemplate,
  listLoraI2vTemplatesForLab,
} from "@/lib/lora-i2v-template";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const templates = await listLoraI2vTemplatesForLab(user.id);
  return NextResponse.json({ templates });
}

const createSchema = z.object({
  title: z.string().min(1).max(120),
  notes: z.string().max(500).optional(),
  stillPrompt: z.string().min(1).max(50000),
  i2vPrompt: z.string().min(1).max(50000),
  negativePrompt: z.string().max(2000).optional(),
  shotsJson: z.string().max(200000).optional(),
  shots: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        stillPrompt: z.string().min(1).max(8000),
        i2vPrompt: z.string().min(1).max(8000),
        negativePrompt: z.string().max(2000).optional(),
        durationSec: z.number().int().min(4).max(12).optional(),
      }),
    )
    .optional(),
  orientation: z.string().max(16).optional(),
  durationSec: z.number().int().min(4).max(3600).optional(),
  pricePeaches: z.number().int().min(0).max(99999).optional(),
  sceneCategory: z.union([z.string(), z.array(z.string())]).optional(),
  previewImageUrl: z.string().max(2000).optional(),
  previewVideoUrl: z.string().max(2000).optional(),
  sourceStillId: z.string().max(64).optional(),
  sourceVideoId: z.string().max(64).optional(),
  characterId: z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const body = createSchema.parse(await req.json());
    let scrub: { triggerWord?: string | null; characterName?: string | null } =
      {};
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
    const template = await createLoraI2vTemplate({
      userId: user.id,
      title: body.title,
      notes: body.notes,
      stillPrompt: body.stillPrompt,
      i2vPrompt: body.i2vPrompt,
      negativePrompt: body.negativePrompt,
      shotsJson: body.shotsJson,
      shots: body.shots?.map((s) => ({
        id: s.id || "",
        stillPrompt: s.stillPrompt,
        i2vPrompt: s.i2vPrompt,
        negativePrompt: s.negativePrompt || "",
        durationSec: s.durationSec || 6,
      })),
      orientation: body.orientation,
      durationSec: body.durationSec,
      pricePeaches: body.pricePeaches,
      sceneCategory: body.sceneCategory,
      previewImageUrl: body.previewImageUrl,
      previewVideoUrl: body.previewVideoUrl,
      sourceStillId: body.sourceStillId,
      sourceVideoId: body.sourceVideoId,
      scrub,
    });
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
