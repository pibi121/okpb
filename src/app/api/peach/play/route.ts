import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { startTemplatePlay } from "@/lib/template-play";

export const runtime = "nodejs";

const schema = z.object({ packId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = schema.parse(await req.json());
    const run = await startTemplatePlay(user.id, body.packId);
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
