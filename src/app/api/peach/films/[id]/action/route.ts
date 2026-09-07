import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  enqueueFilmAction,
  getFilmProject,
  updateFilmProject,
} from "@/lib/film-pipeline";

export const runtime = "nodejs";
export const maxDuration = 900;

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum([
    "script",
    "script_variant",
    "rescript_count",
    "shoot_stills",
    "shoot_clips",
    "stitch",
    "regen_still",
    "regen_clip",
    "edit_still",
    "edit_clip",
    "fast_run",
    "ref2v_run",
  ]),
  sceneIndex: z.number().int().min(0).max(7).optional(),
  editNote: z.string().optional(),
  sceneCount: z.number().int().min(3).max(8).optional(),
  withMusic: z.boolean().optional(),
  musicNote: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = actionSchema.parse(await req.json());
    const existing = await getFilmProject(user.id, id);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.status === "busy") {
      return NextResponse.json({ error: "проект занят", project: existing }, { status: 409 });
    }

    if (body.action === "rescript_count" && body.sceneCount != null) {
      await updateFilmProject(user.id, id, { sceneCount: body.sceneCount });
    }
    if (body.withMusic != null || body.musicNote != null) {
      await updateFilmProject(user.id, id, {
        withMusic: body.withMusic,
        musicNote: body.musicNote,
      });
    }

    await enqueueFilmAction(user.id, id, body.action, {
      sceneIndex: body.sceneIndex,
      editNote: body.editNote,
      sceneCount: body.sceneCount,
    });

    const project = await getFilmProject(user.id, id);
    return NextResponse.json({
      ok: true,
      project,
      message: "Задача поставлена в очередь",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
