import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureBuiltinPresets } from "@/lib/ensure-builtin-presets";

const saveSchema = z.object({
  slug: z.string().min(2).max(64),
  title: z.string().min(2),
  kind: z.enum(["photo", "clip", "film"]),
  payload: z.record(z.string(), z.unknown()),
  notes: z.string().optional(),
});

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  await ensureBuiltinPresets();
  const presets = await prisma.peachPreset.findMany({
    where: { OR: [{ userId: user.id }, { isBuiltin: true }] },
    orderBy: [{ isBuiltin: "desc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({ presets });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const data = saveSchema.parse(await req.json());
  const slug = data.slug
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_|_$/g, "");

  const preset = await prisma.peachPreset.upsert({
    where: { slug },
    create: {
      userId: user.id,
      slug,
      title: data.title,
      kind: data.kind,
      payloadJson: JSON.stringify(data.payload),
      notes: data.notes || null,
      isBuiltin: false,
    },
    update: {
      title: data.title,
      kind: data.kind,
      payloadJson: JSON.stringify(data.payload),
      notes: data.notes || null,
      userId: user.id,
    },
  });
  return NextResponse.json({ preset });
}
