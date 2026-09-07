import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createTgPhotoTemplateFromUpload,
  listTgPhotoTemplatesForLab,
} from "@/lib/tg-photo-template-lab";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const templates = await listTgPhotoTemplatesForLab();
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const form = await req.formData();
  const title = String(form.get("title") || "").trim();
  const editPrompt = String(form.get("editPrompt") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const tier = String(form.get("tier") || "basic");
  const sceneFile = form.get("scenePhoto");

  if (!title || !editPrompt) {
    return NextResponse.json(
      { error: "Нужны название и edit-промпт" },
      { status: 400 },
    );
  }
  if (!(sceneFile instanceof File) || sceneFile.size <= 0) {
    return NextResponse.json(
      { error: "Нужно превью-сцены (картинка шаблона)" },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await sceneFile.arrayBuffer());
  const ext = sceneFile.name.split(".").pop()?.toLowerCase() || "png";

  try {
    const template = await createTgPhotoTemplateFromUpload({
      userId: user.id,
      title,
      editPrompt,
      notes,
      tier: tier === "pose" ? "pose" : "basic",
      sceneBytes: bytes,
      sceneExt: ext,
    });
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
