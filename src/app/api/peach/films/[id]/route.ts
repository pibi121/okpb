import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getFilmProject, updateFilmProject } from "@/lib/film-pipeline";
import type { FilmScene } from "@/lib/film-project";
import { videoOrientationSchema } from "@/lib/video-orientation";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const project = await getFilmProject(user.id, id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project });
}

const patchSchema = z.object({
  idea: z.string().optional(),
  withDialogue: z.boolean().optional(),
  characterIds: z.array(z.string()).max(2).optional(),
  poseIds: z.array(z.string()).optional(),
  sceneCount: z.number().int().min(3).max(8).nullable().optional(),
  aspect: videoOrientationSchema.optional(),
  styleId: z.string().nullable().optional(),
  scenes: z
    .array(
      z.object({
        index: z.number(),
        synopsis: z.string(),
        dialogue: z.string().optional(),
        stillPrompt: z.string().optional(),
        videoPrompt: z.string().optional(),
        poseId: z.string().optional(),
        stillItemId: z.string().optional(),
        stillUrl: z.string().optional(),
        clipItemId: z.string().optional(),
        clipUrl: z.string().optional(),
        status: z.string(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  withMusic: z.boolean().optional(),
  musicNote: z.string().optional(),
  durationSec: z.number().int().min(4).max(12).optional(),
  step: z.string().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const project = await updateFilmProject(user.id, id, {
      ...body,
      scenes: body.scenes as FilmScene[] | undefined,
    });
    return NextResponse.json({ project });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
