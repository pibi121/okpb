import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { coachTemplatePrompt, getOwnedPack } from "@/lib/template-pack";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  message: z.string().min(1),
  frameId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await params;

  const owned = await getOwnedPack(user.id, id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (owned.status === "published") {
    return NextResponse.json({ error: "Шаблон уже опубликован" }, { status: 400 });
  }

  try {
    const body = schema.parse(await req.json());
    const out = await coachTemplatePrompt(user.id, id, body.message, body.frameId);
    return NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
