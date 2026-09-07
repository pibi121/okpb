import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  approveSocialRunPhoto,
  getSocialRun,
  regenSocialRunPhoto,
} from "@/lib/social-ref2v";

export const runtime = "nodejs";
export const maxDuration = 900;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const run = await getSocialRun(user.id, id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const action = req.nextUrl.searchParams.get("action");
  try {
    if (action === "approve") {
      const run = await approveSocialRunPhoto(user.id, id);
      return NextResponse.json({ run });
    }
    if (action === "regen-photo") {
      const run = await regenSocialRunPhoto(user.id, id);
      return NextResponse.json({ run });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
