import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getIdentityPackPublic,
  startIdentityPackGeneration,
} from "@/lib/character-identity-pack";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const startSchema = z.object({
  archiveTraining: z.boolean().optional(),
});

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const pack = await getIdentityPackPublic(user.id, id);
    return NextResponse.json({ pack, character: ch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const body = startSchema.parse(await req.json().catch(() => ({})));
    const result = await startIdentityPackGeneration({
      userId: user.id,
      characterId: id,
      archiveTraining: body.archiveTraining,
    });
    const pack = await getIdentityPackPublic(user.id, id);
    return NextResponse.json({ ...result, pack });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
