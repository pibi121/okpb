import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enqueueAnimateJob } from "@/lib/gallery-jobs";
import { galleryStatus, GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";

export const runtime = "nodejs";
export const maxDuration = 900;

const schema = z.object({
  stillItemId: z.string().min(1),
  i2vPrompt: z.string().min(2).max(8000),
  durationSec: z.number().int().min(4).max(12).optional(),
  withMusic: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const body = schema.parse(await req.json());
    const still = await prisma.galleryItem.findFirst({
      where: { id: body.stillItemId, userId: user.id, kind: "photo" },
    });
    if (!still) {
      return NextResponse.json(
        { error: "Still не найден — сначала сгенерируй фото" },
        { status: 404 },
      );
    }
    const st = galleryStatus(still.metaJson);
    if (st === "pending") {
      return NextResponse.json(
        { error: "Still ещё генерируется — подожди ready" },
        { status: 400 },
      );
    }
    if (st === "error") {
      return NextResponse.json(
        { error: "Still в ошибке — перегенерируй кадр" },
        { status: 400 },
      );
    }
    if (
      !still.resultUrl?.trim() ||
      still.resultUrl === GALLERY_PLACEHOLDER_URL
    ) {
      return NextResponse.json(
        { error: "У still нет файла результата" },
        { status: 400 },
      );
    }

    const item = await enqueueAnimateJob(
      user.id,
      body.stillItemId,
      body.i2vPrompt.trim(),
      body.withMusic,
      body.i2vPrompt.trim(),
      body.durationSec ?? 6,
    );
    return NextResponse.json({ item });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
