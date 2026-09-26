import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { savePhotoEditLabAsTgTemplate } from "@/lib/photo-edit-lab";
import {
  emptyPhotoAnimateConfig,
  type PhotoAnimateConfig,
} from "@/lib/photo-template-animate";

export const runtime = "nodejs";
export const maxDuration = 120;

function parseAnimateFromForm(form: FormData): PhotoAnimateConfig | undefined {
  const raw = String(form.get("animateJson") || "").trim();
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as PhotoAnimateConfig;
    return {
      ...emptyPhotoAnimateConfig(),
      ...j,
      mode: j.mode === "per_duration" ? "per_duration" : "shared",
    };
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const galleryItemId = String(form.get("galleryItemId") || "").trim();
      const title = String(form.get("title") || "").trim();
      const notes = String(form.get("notes") || "").trim();
      const tgDisplayTitle = String(form.get("tgDisplayTitle") || "").trim();
      const editPrompt = String(form.get("editPrompt") || "").trim();
      const teaser = form.get("teaser");
      let previewVideoBytes: Buffer | undefined;
      let previewVideoExt = "mp4";
      if (teaser && typeof teaser === "object" && "arrayBuffer" in teaser) {
        const file = teaser as File;
        previewVideoBytes = Buffer.from(await file.arrayBuffer());
        const name = file.name || "teaser.mp4";
        previewVideoExt = name.split(".").pop()?.toLowerCase() || "mp4";
      }
      if (!galleryItemId) {
        return NextResponse.json({ error: "Нужен galleryItemId" }, { status: 400 });
      }
      if (!title) {
        return NextResponse.json({ error: "Нужно название" }, { status: 400 });
      }
      const template = await savePhotoEditLabAsTgTemplate({
        userId: user.id,
        galleryItemId,
        title,
        notes,
        tgDisplayTitle: tgDisplayTitle || title,
        editPrompt: editPrompt || undefined,
        previewVideoBytes,
        previewVideoExt,
        animate: parseAnimateFromForm(form),
      });
      return NextResponse.json({ template });
    }

    const body = (await req.json()) as {
      galleryItemId?: string;
      title?: string;
      notes?: string;
      tgDisplayTitle?: string;
      editPrompt?: string;
      animate?: PhotoAnimateConfig;
    };
    if (!body.galleryItemId?.trim()) {
      return NextResponse.json({ error: "Нужен galleryItemId" }, { status: 400 });
    }
    if (!body.title?.trim()) {
      return NextResponse.json({ error: "Нужно название" }, { status: 400 });
    }
    const template = await savePhotoEditLabAsTgTemplate({
      userId: user.id,
      galleryItemId: body.galleryItemId.trim(),
      title: body.title.trim(),
      notes: body.notes,
      tgDisplayTitle: body.tgDisplayTitle,
      editPrompt: body.editPrompt,
      animate: body.animate,
    });
    return NextResponse.json({ template });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
