import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listCharacterRefPhotosForUi } from "@/lib/character-ref-pack";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Identity pack + dataset + gallery refs for quick-video / Ref2V UI. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });
  const refs = await listCharacterRefPhotosForUi(user.id, id);
  return NextResponse.json({
    refs,
    source: refs[0]?.source || null,
    count: refs.length,
  });
}
