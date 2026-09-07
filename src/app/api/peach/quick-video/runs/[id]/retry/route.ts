import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { retryQuickVideoRun } from "@/lib/quick-video";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const run = await retryQuickVideoRun(user.id, id);
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
