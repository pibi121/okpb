import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createSocialTemplate,
  listSocialTemplates,
} from "@/lib/social-templates";

export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  kreaPhotoPrompt: z.string().min(10),
  scenePrompt: z.string().optional(),
  motionPrompt: z.string().optional(),
  sam3Target: z.string().optional(),
  durationSec: z.number().int().min(3).max(12).optional(),
});

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const publishedOnly = req.nextUrl.searchParams.get("published") === "1";
  const templates = await listSocialTemplates(user.id, { publishedOnly });
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const data = createSchema.parse(await req.json());
    const tpl = await createSocialTemplate(user.id, data);
    return NextResponse.json({ template: tpl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
