import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  addBeat,
  composeStillPrompt,
  composeVideoPrompt,
  generateStill,
  generateVideo,
  rateStill,
  rateVideo,
  removeBeat,
  suggestBeats,
  updateBeat,
} from "@/lib/story-pack";

export const runtime = "nodejs";
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum([
    "suggest_beats",
    "add_beat",
    "update_beat",
    "remove_beat",
    "compose_still",
    "generate_still",
    "rate_still",
    "compose_video",
    "generate_video",
    "rate_video",
  ]),
  beatId: z.string().optional(),
  ok: z.boolean().optional(),
  skip: z.boolean().optional(),
  note: z.string().optional(),
  title: z.string().optional(),
  beat: z.string().optional(),
  never: z.string().optional(),
  isSex: z.boolean().optional(),
  poseId: z.string().nullable().optional(),
  stillPrompt: z.string().optional(),
  videoPrompt: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = schema.parse(await req.json());
    const beatId = body.beatId;
    let pack;
    switch (body.action) {
      case "suggest_beats":
        pack = await suggestBeats(user.id, id);
        break;
      case "add_beat":
        pack = await addBeat(user.id, id);
        break;
      case "update_beat":
        if (!beatId) throw new Error("beatId");
        pack = await updateBeat(user.id, id, beatId, {
          title: body.title,
          beat: body.beat,
          never: body.never,
          isSex: body.isSex,
          poseId: body.poseId,
          stillPrompt: body.stillPrompt,
          videoPrompt: body.videoPrompt,
        });
        break;
      case "remove_beat":
        if (!beatId) throw new Error("beatId");
        pack = await removeBeat(user.id, id, beatId);
        break;
      case "compose_still":
        if (!beatId) throw new Error("beatId");
        pack = await composeStillPrompt(user.id, id, beatId);
        break;
      case "generate_still":
        if (!beatId) throw new Error("beatId");
        pack = await generateStill(user.id, id, beatId);
        break;
      case "rate_still":
        if (!beatId) throw new Error("beatId");
        pack = await rateStill(user.id, id, beatId, !!body.ok, body.note);
        break;
      case "compose_video":
        if (!beatId) throw new Error("beatId");
        pack = await composeVideoPrompt(user.id, id, beatId);
        break;
      case "generate_video":
        if (!beatId) throw new Error("beatId");
        pack = await generateVideo(user.id, id, beatId);
        break;
      case "rate_video":
        if (!beatId) throw new Error("beatId");
        pack = await rateVideo(user.id, id, beatId, !!body.ok, body.note, body.skip);
        break;
      default:
        throw new Error("unknown action");
    }
    return NextResponse.json({ pack });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
