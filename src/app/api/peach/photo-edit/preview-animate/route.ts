import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { enqueuePhotoEditAnimatePreview } from "@/lib/photo-edit-preview-animate";
import { mapGalleryItem } from "@/lib/gallery-meta";

export const runtime = "nodejs";
export const maxDuration = 900;

const schema = z.object({
  i2vPrompt: z.string().min(2).max(8000),
  durationSec: z.union([z.literal(3), z.literal(7), z.literal(12)]),
  stillItemId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
});

/** Lab 2.0: preview I2V from pose animate prompt before locking into template. */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const body = schema.parse(await req.json());
    if (!body.stillItemId && !body.templateId) {
      return NextResponse.json(
        { error: "Нужен кадр (stillItemId) или шаблон (templateId)" },
        { status: 400 },
      );
    }
    const result = await enqueuePhotoEditAnimatePreview({
      userId: user.id,
      stillItemId: body.stillItemId,
      templateId: body.templateId,
      i2vPrompt: body.i2vPrompt,
      durationSec: body.durationSec,
    });
    return NextResponse.json({
      ok: true,
      item: mapGalleryItem(result.item),
      stillItemId: result.stillItemId,
      requestedDurationSec: result.requestedDurationSec,
      engineDurationSec: result.engineDurationSec,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
