import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOwnedRun, toPublicRun } from "@/lib/template-play";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ runId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { runId } = await params;
  const owned = await getOwnedRun(user.id, runId);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const run = await toPublicRun(runId);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}
