import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { enqueueLoraI2vStitchJob } from "@/lib/lora-i2v-stitch";

export const runtime = "nodejs";
/** Enqueue only — actual stitch runs in GPU queue. */
export const maxDuration = 60;

const schema = z.object({
  videoItemIds: z.array(z.string().min(1)).min(2),
  title: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const body = schema.parse(await req.json());
    const out = await enqueueLoraI2vStitchJob({
      userId: user.id,
      videoItemIds: body.videoItemIds,
      title: body.title,
    });
    return NextResponse.json({
      item: out.item,
      durationSec: out.durationSec,
      pending: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
