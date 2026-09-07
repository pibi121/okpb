import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  deleteStoryPack,
  getOwnedPack,
  toPublicPack,
  updateStoryPack,
} from "@/lib/story-pack";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const owned = await getOwnedPack(user.id, id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const pack = await toPublicPack(id);
  return NextResponse.json({ pack });
}

const patchSchema = z.object({
  title: z.string().optional(),
  idea: z.string().optional(),
  genre: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
  locationNote: z.string().optional(),
  styleId: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const pack = await updateStoryPack(user.id, id, body);
    return NextResponse.json({ pack });
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
    await deleteStoryPack(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
