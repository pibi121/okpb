import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labAccess } from "@/lib/ops/roles";
import {
  publishPhotoTemplateToTg,
  unpublishPhotoTemplateFromTg,
  updatePhotoTemplateTgMeta,
  publishQuickVideoTemplateToTg,
  unpublishQuickVideoTemplateFromTg,
  updateQuickVideoTemplateTgMeta,
} from "@/lib/tg/tg-publish";
import {
  publishLoraI2vTemplateToTg,
  unpublishLoraI2vTemplateFromTg,
  updateLoraI2vTemplateTgMeta,
} from "@/lib/lora-i2v-template";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ kind: string; id: string }> };

const patchSchema = z.object({
  displayTitle: z.string().max(120).optional(),
  title: z.string().min(1).max(120).optional(),
  tgPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

async function assertLab() {
  const user = await requireUser();
  if (!user) return { error: NextResponse.json({ error: "auth" }, { status: 401 }) };
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  if (!labAccess(row?.adminRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const { kind, id } = await ctx.params;
  const body = patchSchema.parse(await req.json().catch(() => ({})));

  try {
    if (kind === "photo") {
      if (body.title !== undefined) {
        await prisma.photoTemplate.update({
          where: { id },
          data: { title: body.title.trim() },
        });
      }
      if (body.displayTitle !== undefined || body.sortOrder !== undefined) {
        await updatePhotoTemplateTgMeta(id, {
          displayTitle: body.displayTitle,
          sortOrder: body.sortOrder,
        });
      }
      if (body.tgPublished === true) {
        await publishPhotoTemplateToTg(id, {
          displayTitle: body.displayTitle,
        });
      } else if (body.tgPublished === false) {
        await unpublishPhotoTemplateFromTg(id);
      }
      const template = await prisma.photoTemplate.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, template });
    }

    if (kind === "video") {
      if (body.title !== undefined) {
        await prisma.quickVideoTemplate.update({
          where: { id },
          data: { title: body.title.trim() },
        });
      }
      if (body.displayTitle !== undefined || body.sortOrder !== undefined) {
        await updateQuickVideoTemplateTgMeta(id, {
          displayTitle: body.displayTitle,
          sortOrder: body.sortOrder,
        });
      }
      if (body.tgPublished === true) {
        await publishQuickVideoTemplateToTg(id, {
          displayTitle: body.displayTitle,
        });
      } else if (body.tgPublished === false) {
        await unpublishQuickVideoTemplateFromTg(id);
      }
      const template = await prisma.quickVideoTemplate.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, template });
    }

    if (kind === "lora_i2v") {
      if (body.title !== undefined) {
        await prisma.loraI2vTemplate.update({
          where: { id },
          data: { title: body.title.trim() },
        });
      }
      if (body.displayTitle !== undefined || body.sortOrder !== undefined) {
        await updateLoraI2vTemplateTgMeta(id, {
          displayTitle: body.displayTitle,
          sortOrder: body.sortOrder,
        });
      }
      if (body.tgPublished === true) {
        await publishLoraI2vTemplateToTg(id, {
          displayTitle: body.displayTitle,
        });
      } else if (body.tgPublished === false) {
        await unpublishLoraI2vTemplateFromTg(id);
      }
      const template = await prisma.loraI2vTemplate.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, template });
    }

    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
