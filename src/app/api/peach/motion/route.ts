import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createMotionTemplate,
  listMotionTemplates,
} from "@/lib/motion-templates";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const publishedOnly = req.nextUrl.searchParams.get("published") === "1";
  const templates = await listMotionTemplates(user.id, { publishedOnly });
  return NextResponse.json({ templates });
}

const createSchema = z.object({
  title: z.string().min(1).max(120),
  notes: z.string().max(2000).optional(),
  positivePrompt: z.string().max(4000).optional(),
  negativePrompt: z.string().max(4000).optional(),
  width: z.number().int().min(256).max(1280).optional(),
  height: z.number().int().min(256).max(1280).optional(),
  frameCount: z.number().int().min(17).max(481).optional(),
  fps: z.number().int().min(8).max(30).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = createSchema.parse(await req.json());
    const template = await createMotionTemplate(user.id, body);
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
