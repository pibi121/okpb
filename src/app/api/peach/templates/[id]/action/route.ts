import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  addGalleryToTemplate,
  approveTemplateFrame,
  deleteTemplateFrame,
  getOwnedPack,
  publishTemplatePack,
  rejectTemplateFrame,
  reorderTemplateFrames,
  stitchTemplatePack,
  toPublicPack,
  updateTemplateFrame,
  animateTemplateFrame,
} from "@/lib/template-pack";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_gallery"),
    itemId: z.string(),
    frameId: z.string().optional(),
    beat: z.string().optional(),
    never: z.string().optional(),
  }),
  z.object({
    action: z.literal("update_frame"),
    frameId: z.string(),
    patch: z
      .object({
        title: z.string().optional(),
        beat: z.string().optional(),
        never: z.string().optional(),
        stillPrompt: z.string().optional(),
        videoPrompt: z.string().optional(),
        durationSec: z.number().int().min(3).max(15).optional(),
        poseId: z.string().nullable().optional(),
        stillFailNote: z.string().optional(),
        videoFailNote: z.string().optional(),
        dialogue: z.string().optional(),
        soloCharacterIndex: z.number().int().nullable().optional(),
        clothed: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({ action: z.literal("approve_frame"), frameId: z.string() }),
  z.object({
    action: z.literal("reject_frame"),
    frameId: z.string(),
    stillNote: z.string().optional(),
    videoNote: z.string().optional(),
  }),
  z.object({ action: z.literal("delete_frame"), frameId: z.string() }),
  z.object({ action: z.literal("reorder"), frameIds: z.array(z.string()) }),
  z.object({
    action: z.literal("animate_frame"),
    frameId: z.string(),
    plot: z.string().optional(),
    note: z.string().optional(),
    composedPrompt: z.string().optional(),
    durationSec: z.number().int().min(4).max(12).optional(),
    withMusic: z.boolean().optional(),
    dialogue: z.string().optional(),
  }),
  z.object({
    action: z.literal("stitch"),
    withMusic: z.boolean().optional(),
    musicNote: z.string().optional(),
  }),
  z.object({ action: z.literal("publish") }),
]);

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await params;

  const owned = await getOwnedPack(user.id, id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const body = actionSchema.parse(await req.json());

    switch (body.action) {
      case "add_gallery": {
        const out = await addGalleryToTemplate(user.id, id, {
          itemId: body.itemId,
          frameId: body.frameId,
          beat: body.beat,
          never: body.never,
        });
        return NextResponse.json(out);
      }
      case "update_frame": {
        const pack = await updateTemplateFrame(user.id, id, body.frameId, body.patch || {});
        return NextResponse.json({ pack });
      }
      case "approve_frame": {
        const pack = await approveTemplateFrame(user.id, id, body.frameId);
        return NextResponse.json({ pack });
      }
      case "reject_frame": {
        const pack = await rejectTemplateFrame(user.id, id, body.frameId, {
          still: body.stillNote,
          video: body.videoNote,
        });
        return NextResponse.json({ pack });
      }
      case "delete_frame": {
        const pack = await deleteTemplateFrame(user.id, id, body.frameId);
        return NextResponse.json({ pack });
      }
      case "reorder": {
        const pack = await reorderTemplateFrames(user.id, id, body.frameIds);
        return NextResponse.json({ pack });
      }
      case "animate_frame": {
        const pack = await animateTemplateFrame(user.id, id, body.frameId, {
          plot: body.plot,
          note: body.note,
          composedPrompt: body.composedPrompt,
          durationSec: body.durationSec,
          withMusic: body.withMusic,
          dialogue: body.dialogue,
        });
        return NextResponse.json({ pack });
      }
      case "stitch": {
        const pack = await stitchTemplatePack(user.id, id, {
          withMusic: body.withMusic,
          musicNote: body.musicNote,
        });
        return NextResponse.json({ pack });
      }
      case "publish": {
        const pack = await publishTemplatePack(user.id, id);
        return NextResponse.json({ pack });
      }
      default:
        return NextResponse.json({ error: "unknown" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await params;
  const pack = await toPublicPack(id);
  if (!pack) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ pack });
}
