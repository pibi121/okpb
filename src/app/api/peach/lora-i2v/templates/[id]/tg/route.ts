import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  publishLoraI2vTemplateToTg,
  unpublishLoraI2vTemplateFromTg,
  updateLoraI2vTemplateTgMeta,
} from "@/lib/lora-i2v-template";

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
    const owned = await import("@/lib/lora-i2v-template").then((m) =>
      m.getLoraI2vTemplate(user.id, id),
    );
    if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
    const template = await publishLoraI2vTemplateToTg(id, {
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
    const owned = await import("@/lib/lora-i2v-template").then((m) =>
      m.getLoraI2vTemplate(user.id, id),
    );
    if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = patchSchema.parse(await req.json());
    const template = await updateLoraI2vTemplateTgMeta(id, body);
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
    const owned = await import("@/lib/lora-i2v-template").then((m) =>
      m.getLoraI2vTemplate(user.id, id),
    );
    if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
    const template = await unpublishLoraI2vTemplateFromTg(id);
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
