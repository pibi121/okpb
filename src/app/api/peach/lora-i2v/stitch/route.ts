import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { stitchLoraI2vGalleryClips } from "@/lib/lora-i2v-stitch";

export const runtime = "nodejs";
export const maxDuration = 900;

const schema = z.object({
  videoItemIds: z.array(z.string().min(1)).min(2),
  title: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const body = schema.parse(await req.json());
    const out = await stitchLoraI2vGalleryClips({
      userId: user.id,
      videoItemIds: body.videoItemIds,
      title: body.title,
    });
    return NextResponse.json({
      item: {
        id: out.item.id,
        resultUrl: out.resultUrl,
        kind: "video",
      },
      resultUrl: out.resultUrl,
      durationSec: out.durationSec,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
