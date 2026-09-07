import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  enqueueMotionTemplateGenerate,
  getMotionTemplate,
  updateMotionTemplate,
} from "@/lib/motion-templates";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 900;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const template = await getMotionTemplate(user.id, id);
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ template });
}

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  notes: z.string().max(2000).optional(),
  drivingVideoUrl: z.string().optional(),
  referenceImageUrl: z.string().optional(),
  positivePrompt: z.string().max(4000).optional(),
  negativePrompt: z.string().max(4000).optional(),
  width: z.number().int().min(256).max(1280).optional(),
  height: z.number().int().min(256).max(1280).optional(),
  frameCount: z.number().int().min(17).max(481).optional(),
  fps: z.number().int().min(8).max(30).optional(),
  published: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const template = await updateMotionTemplate(user.id, id, body);
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  await prisma.motionTemplate.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}

const actionSchema = z.object({
  action: z.enum(["generate", "publish", "unpublish"]),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = actionSchema.parse(await req.json());
    if (body.action === "generate") {
      const template = await enqueueMotionTemplateGenerate(user.id, id);
      return NextResponse.json({
        ok: true,
        template,
        message: "Генерация Wan Animate 2 запущена",
      });
    }
    if (body.action === "publish") {
      const template = await updateMotionTemplate(user.id, id, { published: true });
      return NextResponse.json({ template });
    }
    const template = await updateMotionTemplate(user.id, id, { published: false });
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
