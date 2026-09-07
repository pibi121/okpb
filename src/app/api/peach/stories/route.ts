import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createStoryPack, listStoryPacks } from "@/lib/story-pack";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const packs = await listStoryPacks(user.id);
  return NextResponse.json({ packs });
}

const createSchema = z.object({
  title: z.string().optional(),
  idea: z.string().min(4),
  genre: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
  locationNote: z.string().optional(),
  styleId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = createSchema.parse(await req.json());
    const pack = await createStoryPack(user.id, {
      title: body.title || body.idea.slice(0, 48),
      idea: body.idea,
      genre: body.genre,
      characterIds: body.characterIds,
      locationNote: body.locationNote,
      styleId: body.styleId,
    });
    return NextResponse.json({ pack });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
