import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getQuickVideoTemplateDetail } from "@/lib/quick-video-template";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const template = await getQuickVideoTemplateDetail(user.id, id);
  if (!template) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ template });
}
