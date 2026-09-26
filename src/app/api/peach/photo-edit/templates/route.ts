import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getPhotoTemplateById,
  listAllPhotoTemplatesForLab,
  updatePhotoTemplateLabMeta,
} from "@/lib/tg-photo-template-lab";
import {
  emptyPhotoAnimateConfig,
  type PhotoAnimateConfig,
} from "@/lib/photo-template-animate";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (id) {
    const template = await getPhotoTemplateById(id);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  }
  const templates = await listAllPhotoTemplatesForLab();
  return NextResponse.json({ templates });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const templateId = String(form.get("templateId") || "").trim();
      if (!templateId) {
        return NextResponse.json({ error: "templateId" }, { status: 400 });
      }
      let animate: PhotoAnimateConfig | undefined;
      const animateRaw = String(form.get("animateJson") || "").trim();
      if (animateRaw) {
        try {
          const j = JSON.parse(animateRaw) as PhotoAnimateConfig;
          animate = {
            ...emptyPhotoAnimateConfig(),
            ...j,
            mode: j.mode === "per_duration" ? "per_duration" : "shared",
          };
        } catch {
          /* ignore */
        }
      }
      const teaser = form.get("teaser");
      let previewVideoBytes: Buffer | undefined;
      let previewVideoExt = "mp4";
      if (teaser && typeof teaser === "object" && "arrayBuffer" in teaser) {
        const file = teaser as File;
        previewVideoBytes = Buffer.from(await file.arrayBuffer());
        previewVideoExt =
          (file.name || "teaser.mp4").split(".").pop()?.toLowerCase() || "mp4";
      }
      const tgPublishedRaw = form.get("tgPublished");
      const template = await updatePhotoTemplateLabMeta({
        userId: user.id,
        templateId,
        title: form.has("title")
          ? String(form.get("title") || "")
          : undefined,
        notes: form.has("notes")
          ? String(form.get("notes") || "")
          : undefined,
        tgDisplayTitle: form.has("tgDisplayTitle")
          ? String(form.get("tgDisplayTitle") || "")
          : undefined,
        sceneCategory: form.has("sceneCategory")
          ? String(form.get("sceneCategory") || "")
          : undefined,
        tgPublished:
          tgPublishedRaw === null || tgPublishedRaw === undefined
            ? undefined
            : String(tgPublishedRaw) === "1" || String(tgPublishedRaw) === "true",
        animate,
        previewVideoBytes,
        previewVideoExt,
      });
      return NextResponse.json({ template });
    }

    const body = (await req.json()) as {
      templateId?: string;
      title?: string;
      notes?: string;
      tgDisplayTitle?: string;
      sceneCategory?: string;
      tgPublished?: boolean;
      animate?: PhotoAnimateConfig;
    };
    if (!body.templateId?.trim()) {
      return NextResponse.json({ error: "templateId" }, { status: 400 });
    }
    const template = await updatePhotoTemplateLabMeta({
      userId: user.id,
      templateId: body.templateId.trim(),
      title: body.title,
      notes: body.notes,
      tgDisplayTitle: body.tgDisplayTitle,
      sceneCategory: body.sceneCategory,
      tgPublished: body.tgPublished,
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
