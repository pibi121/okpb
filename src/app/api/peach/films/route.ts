import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createFilmProject,
  listFilmProjects,
} from "@/lib/film-pipeline";
import { estimateFilmQuote } from "@/lib/film-project";
import { videoOrientationSchema } from "@/lib/video-orientation";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const projects = await listFilmProjects(user.id);
  return NextResponse.json({ projects });
}

const createSchema = z.object({
  mode: z.enum(["studio", "fast"]).optional(),
  idea: z.string().min(3),
  withDialogue: z.boolean().optional(),
  characterIds: z.array(z.string()).max(2).optional(),
  poseIds: z.array(z.string()).optional(),
  sceneCount: z.number().int().min(3).max(8).nullable().optional(),
  aspect: videoOrientationSchema.optional(),
  styleId: z.string().nullable().optional(),
  durationSec: z.number().int().min(4).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = createSchema.parse(await req.json());
    const project = await createFilmProject(user.id, body);
    const quote = estimateFilmQuote({
      sceneCount: body.sceneCount ?? 4,
      withMusic: false,
    });
    return NextResponse.json({ project, quote });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
