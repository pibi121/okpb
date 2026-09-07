import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPeachPhotoTemplateDetail } from "@/lib/peach-photo-template";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const template = await getPeachPhotoTemplateDetail(user.id, id);
  if (!template) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ template });
}
