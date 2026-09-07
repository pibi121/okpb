import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  publishQuickVideoTemplateToTg,
  unpublishQuickVideoTemplateFromTg,
  updateQuickVideoTemplateTgMeta,
} from "@/lib/tg/tg-publish";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  displayTitle: z.string().max(120).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function POST(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = patchSchema.parse(await _req.json().catch(() => ({})));
    const template = await publishQuickVideoTemplateToTg(id, {
      displayTitle: body.displayTitle,
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
    const template = await updateQuickVideoTemplateTgMeta(id, body);
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
    const template = await unpublishQuickVideoTemplateFromTg(id);
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
