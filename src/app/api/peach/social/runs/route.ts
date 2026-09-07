import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  approveSocialRunPhoto,
  listSocialRuns,
  regenSocialRunPhoto,
  startSocialRun,
} from "@/lib/social-ref2v";
import { socialOrientationSchema } from "@/lib/video-orientation";

export const runtime = "nodejs";
export const maxDuration = 900;

const startSchema = z.object({
  action: z.literal("start"),
  templateId: z.string(),
  characterId: z.string(),
  title: z.string().optional(),
  clothed: z.boolean().optional(),
  wardrobeNote: z.string().max(500).optional(),
  orientation: socialOrientationSchema.optional(),
});

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const runs = await listSocialRuns(user.id);
  return NextResponse.json({ runs });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = await req.json();
    if (body?.action === "start") {
      const data = startSchema.parse(body);
      const run = await startSocialRun({
        userId: user.id,
        templateId: data.templateId,
        characterId: data.characterId,
        title: data.title,
        clothed: data.clothed,
        wardrobeNote: data.wardrobeNote,
        orientation: data.orientation,
      });
      return NextResponse.json({ run });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
