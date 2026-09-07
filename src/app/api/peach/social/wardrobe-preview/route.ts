import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getSocialTemplateInternal } from "@/lib/social-templates";
import { composeSocialWardrobeLLM } from "@/lib/social-wardrobe-llm";

export const runtime = "nodejs";

const schema = z.object({
  clothed: z.boolean(),
  wardrobeNote: z.string().max(500).optional(),
  templateId: z.string().optional(),
});

/** Text-only preview: expand wardrobe note → English Krea block (LLM or fallback). */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const data = schema.parse(await req.json());
    let sceneHint = "";
    if (data.templateId) {
      const tpl = await getSocialTemplateInternal(user.id, data.templateId);
      sceneHint = tpl?.kreaPhotoPrompt || "";
    }
    const out = await composeSocialWardrobeLLM({
      clothed: data.clothed,
      wardrobeNote: data.wardrobeNote,
      sceneHint,
      skipTunnel: true,
    });
    return NextResponse.json({
      wardrobeLine: out.wardrobeLine,
      detailEn: out.detailEn || null,
      source: out.source,
      llmAvailable: out.source === "llm",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
