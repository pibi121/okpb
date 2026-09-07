import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  animateAllRunFrames,
  animateRunFrame,
  generateRunStills,
  getOwnedRun,
  setRunCharacters,
  updateRunFrame,
} from "@/lib/template-play";

export const runtime = "nodejs";
export const maxDuration = 180;

type Ctx = { params: Promise<{ runId: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_characters"),
    characterIds: z.array(z.string()).min(1).max(4),
  }),
  z.object({ action: z.literal("generate_stills") }),
  z.object({
    action: z.literal("update_frame"),
    frameId: z.string(),
    patch: z
      .object({
        videoNote: z.string().optional(),
        dialogue: z.string().optional(),
        durationSec: z.number().int().min(4).max(12).optional(),
        videoPrompt: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    action: z.literal("animate_frame"),
    frameId: z.string(),
    withMusic: z.boolean().optional(),
  }),
  z.object({ action: z.literal("animate_all") }),
]);

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { runId } = await params;
  const owned = await getOwnedRun(user.id, runId);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const body = schema.parse(await req.json());
    switch (body.action) {
      case "set_characters": {
        const run = await setRunCharacters(user.id, runId, body.characterIds);
        return NextResponse.json({ run });
      }
      case "generate_stills": {
        const run = await generateRunStills(user.id, runId);
        return NextResponse.json({ run });
      }
      case "update_frame": {
        const run = await updateRunFrame(user.id, runId, body.frameId, body.patch || {});
        return NextResponse.json({ run });
      }
      case "animate_frame": {
        const run = await animateRunFrame(user.id, runId, body.frameId, {
          withMusic: body.withMusic,
        });
        return NextResponse.json({ run });
      }
      case "animate_all": {
        const run = await animateAllRunFrames(user.id, runId);
        return NextResponse.json({ run });
      }
      default:
        return NextResponse.json({ error: "unknown" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
