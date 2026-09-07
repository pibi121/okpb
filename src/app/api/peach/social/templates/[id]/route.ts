import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  deleteSocialTemplate,
  getSocialTemplate,
  publishSocialTemplate,
  saveTemplateMedia,
  updateSocialTemplate,
} from "@/lib/social-templates";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().optional(),
  notes: z.string().optional(),
  kreaPhotoPrompt: z.string().optional(),
  scenePrompt: z.string().optional(),
  motionPrompt: z.string().optional(),
  sam3Target: z.string().optional(),
  durationSec: z.number().int().min(3).max(12).optional(),
  previewVideoUrl: z.string().optional(),
  previewPhotoUrl: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const tpl = await getSocialTemplate(user.id, id);
  if (!tpl) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ template: tpl });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const data = patchSchema.parse(await req.json());
    const tpl = await updateSocialTemplate(user.id, id, data);
    return NextResponse.json({ template: tpl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await deleteSocialTemplate(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const action = req.nextUrl.searchParams.get("action");

  if (action === "publish") {
    try {
      const tpl = await publishSocialTemplate(user.id, id);
      return NextResponse.json({ template: tpl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "upload") {
    const form = await req.formData();
    const kind = String(form.get("kind") || "driving");
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    const ext = name.endsWith(".webm")
      ? "webm"
      : name.endsWith(".mov")
        ? "mov"
        : name.endsWith(".png")
          ? "png"
          : name.endsWith(".jpg") || name.endsWith(".jpeg")
            ? "jpg"
            : kind === "driving"
              ? "mp4"
              : "png";
    const saved = saveTemplateMedia(
      user.id,
      ext,
      buf,
      `social_tpl_${id}_${kind}`,
    );
    const patch =
      kind === "preview_video"
        ? { previewVideoUrl: saved.publicUrl }
        : kind === "preview_photo"
          ? { previewPhotoUrl: saved.publicUrl }
          : { drivingVideoUrl: saved.publicUrl };
    const tpl = await updateSocialTemplate(user.id, id, patch);
    return NextResponse.json({ template: tpl, url: saved.publicUrl });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
