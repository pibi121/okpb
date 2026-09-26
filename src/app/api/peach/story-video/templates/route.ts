import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveGalleryBinary } from "@/lib/local-store";
import {
  formatVideoFunnelCategories,
  parseVideoFunnelCategories,
} from "@/lib/photo-template-animate";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const templates = await prisma.quickVideoTemplate.findMany({
    where: { userId: user.id },
    orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      notes: true,
      durationSec: true,
      previewVideoUrl: true,
      previewPhotoUrl: true,
      tgPublished: true,
      tgDisplayTitle: true,
      tgSortOrder: true,
      sceneCategory: true,
      published: true,
      pricePeaches: true,
      updatedAt: true,
    },
  });
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
      const row = await prisma.quickVideoTemplate.findFirst({
        where: { id: templateId, userId: user.id },
      });
      if (!row) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }

      const data: Record<string, unknown> = {};
      if (form.has("title")) data.title = String(form.get("title") || "").trim().slice(0, 120);
      if (form.has("notes")) data.notes = String(form.get("notes") || "").trim().slice(0, 2000);
      if (form.has("tgDisplayTitle")) {
        data.tgDisplayTitle = String(form.get("tgDisplayTitle") || "")
          .trim()
          .slice(0, 80);
      }
      if (form.has("tgPublished")) {
        data.tgPublished =
          String(form.get("tgPublished")) === "1" ||
          String(form.get("tgPublished")) === "true";
      }
      if (form.has("sceneCategory")) {
        const cats = parseVideoFunnelCategories(String(form.get("sceneCategory") || ""));
        data.sceneCategory = formatVideoFunnelCategories(cats);
      }
      const teaser = form.get("teaser");
      if (teaser && typeof teaser === "object" && "arrayBuffer" in teaser) {
        const file = teaser as File;
        const bytes = Buffer.from(await file.arrayBuffer());
        const ext =
          (file.name || "teaser.mp4").split(".").pop()?.toLowerCase() || "mp4";
        const saved = saveGalleryBinary(user.id, ext, bytes, "story_h3_teaser");
        data.previewVideoUrl = saved.publicUrl;
      }

      const updated = await prisma.quickVideoTemplate.update({
        where: { id: templateId },
        data,
      });
      return NextResponse.json({ template: updated });
    }

    const body = (await req.json()) as {
      templateId?: string;
      title?: string;
      notes?: string;
      tgDisplayTitle?: string;
      tgPublished?: boolean;
      sceneCategory?: string;
    };
    if (!body.templateId?.trim()) {
      return NextResponse.json({ error: "templateId" }, { status: 400 });
    }
    const row = await prisma.quickVideoTemplate.findFirst({
      where: { id: body.templateId.trim(), userId: user.id },
    });
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title.trim().slice(0, 120);
    if (body.notes !== undefined) data.notes = body.notes.trim().slice(0, 2000);
    if (body.tgDisplayTitle !== undefined) {
      data.tgDisplayTitle = body.tgDisplayTitle.trim().slice(0, 80);
    }
    if (body.tgPublished !== undefined) data.tgPublished = body.tgPublished;
    if (body.sceneCategory !== undefined) {
      data.sceneCategory = formatVideoFunnelCategories(
        parseVideoFunnelCategories(body.sceneCategory),
      );
    }
    const updated = await prisma.quickVideoTemplate.update({
      where: { id: body.templateId.trim() },
      data,
    });
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
