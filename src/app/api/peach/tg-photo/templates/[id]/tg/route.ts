import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  publishPhotoTemplateToTg,
  unpublishPhotoTemplateFromTg,
  updatePhotoTemplateTgMeta,
} from "@/lib/tg/tg-publish";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  displayTitle: z.string().max(120).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  sceneCategory: z.string().max(120).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const template = await publishPhotoTemplateToTg(id, {
      displayTitle: body.displayTitle,
      sceneCategory: body.sceneCategory,
    });
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = patchSchema.parse(await req.json());
    const template = await updatePhotoTemplateTgMeta(id, body);
    return NextResponse.json({ ok: true, template });
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
    const template = await unpublishPhotoTemplateFromTg(id);
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
