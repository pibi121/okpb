import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labAccess } from "@/lib/ops/roles";
import { resolveTgCatalogAssetUrl } from "@/lib/tg/catalog-asset-url";
import {
  formatVideoFunnelCategories,
  parseVideoFunnelCategories,
} from "@/lib/photo-template-animate";
import {
  publishPhotoTemplateToTg,
  unpublishPhotoTemplateFromTg,
  publishQuickVideoTemplateToTg,
  unpublishQuickVideoTemplateFromTg,
} from "@/lib/tg/tg-publish";
import {
  publishLoraI2vTemplateToTg,
  unpublishLoraI2vTemplateFromTg,
} from "@/lib/lora-i2v-template";

export const runtime = "nodejs";
export const maxDuration = 120;

type Kind = "photo" | "video" | "lora_i2v";

function firstUrl(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const u = (c || "").trim();
    if (u) return u;
  }
  return "";
}

async function assertLab() {
  const user = await requireUser();
  if (!user) {
    return { error: NextResponse.json({ error: "auth" }, { status: 401 }) };
  }
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  if (!labAccess(row?.adminRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}

/** Lab 2.0 — списки шаблонов для переноса в TG-воронку. */
export async function GET() {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const [photos, videos, loraI2v] = await Promise.all([
    prisma.photoTemplate.findMany({
      orderBy: [
        { tgPublished: "desc" },
        { sortOrder: "asc" },
        { updatedAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        title: true,
        notes: true,
        tgDisplayTitle: true,
        tgPublished: true,
        sceneCategory: true,
        previewImageUrl: true,
        previewVideoUrl: true,
        sceneImageUrl: true,
        sortOrder: true,
        updatedAt: true,
      },
    }),
    prisma.quickVideoTemplate.findMany({
      orderBy: [
        { tgPublished: "desc" },
        { tgSortOrder: "asc" },
        { updatedAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        title: true,
        notes: true,
        tgDisplayTitle: true,
        tgPublished: true,
        sceneCategory: true,
        previewPhotoUrl: true,
        previewVideoUrl: true,
        durationSec: true,
        tgSortOrder: true,
        updatedAt: true,
      },
    }),
    prisma.loraI2vTemplate.findMany({
      orderBy: [
        { tgPublished: "desc" },
        { tgSortOrder: "asc" },
        { updatedAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        title: true,
        notes: true,
        tgDisplayTitle: true,
        tgPublished: true,
        sceneCategory: true,
        previewImageUrl: true,
        previewVideoUrl: true,
        durationSec: true,
        tgSortOrder: true,
        requiresLora: true,
        updatedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    photo: photos.map((r) => ({
      kind: "photo" as const,
      id: r.id,
      title: r.title,
      notes: r.notes || "",
      displayTitle: r.tgDisplayTitle || "",
      tgPublished: r.tgPublished,
      sceneCategory: r.sceneCategory || "",
      previewImageUrl: resolveTgCatalogAssetUrl(
        firstUrl(r.previewImageUrl, r.sceneImageUrl),
      ),
      previewVideoUrl: resolveTgCatalogAssetUrl(r.previewVideoUrl || ""),
      sortOrder: r.sortOrder,
      durationSec: 0,
      updatedAt: r.updatedAt.toISOString(),
      labHref: `/peach/photo-edit`,
    })),
    video: videos.map((r) => ({
      kind: "video" as const,
      id: r.id,
      title: r.title,
      notes: r.notes || "",
      displayTitle: r.tgDisplayTitle || "",
      tgPublished: r.tgPublished,
      sceneCategory: r.sceneCategory || "",
      previewImageUrl: resolveTgCatalogAssetUrl(firstUrl(r.previewPhotoUrl)),
      previewVideoUrl: resolveTgCatalogAssetUrl(r.previewVideoUrl || ""),
      sortOrder: r.tgSortOrder,
      durationSec: r.durationSec || 0,
      updatedAt: r.updatedAt.toISOString(),
      labHref: `/peach/story-video`,
    })),
    lora_i2v: loraI2v.map((r) => ({
      kind: "lora_i2v" as const,
      id: r.id,
      title: r.title,
      notes: r.notes || "",
      displayTitle: r.tgDisplayTitle || "",
      tgPublished: r.tgPublished,
      sceneCategory: r.sceneCategory || "",
      previewImageUrl: resolveTgCatalogAssetUrl(firstUrl(r.previewImageUrl)),
      previewVideoUrl: resolveTgCatalogAssetUrl(r.previewVideoUrl || ""),
      sortOrder: r.tgSortOrder,
      durationSec: r.durationSec || 0,
      requiresLora: r.requiresLora,
      updatedAt: r.updatedAt.toISOString(),
      labHref: `/peach/lora-i2v?templateId=${r.id}`,
    })),
  });
}

const itemPatchSchema = z.object({
  kind: z.enum(["photo", "video", "lora_i2v"]),
  id: z.string().min(1).max(80),
  tgPublished: z.boolean().optional(),
  displayTitle: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
  sceneCategory: z.string().max(120).optional(),
  previewImageUrl: z.string().max(2000).optional(),
  previewVideoUrl: z.string().max(2000).optional(),
});

const batchSchema = z.object({
  items: z.array(itemPatchSchema).min(1).max(120),
});

/** Batch save: галочки + мета TG (название кнопки, категория, описание, превью URL). */
export async function PATCH(req: NextRequest) {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const body = batchSchema.parse(await req.json().catch(() => ({})));
  const results: Array<{ kind: Kind; id: string; ok: boolean; error?: string }> =
    [];

  for (const item of body.items) {
    try {
      await applyItemPatch(item);
      results.push({ kind: item.kind, id: item.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ kind: item.kind, id: item.id, ok: false, error: msg });
    }
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({
    ok: failed.length === 0,
    saved: results.filter((r) => r.ok).length,
    failed,
  });
}

async function applyItemPatch(
  item: z.infer<typeof itemPatchSchema>,
): Promise<void> {
  const displayTitle = item.displayTitle?.trim();
  const notes = item.notes !== undefined ? item.notes.trim().slice(0, 2000) : undefined;
  const sceneCategory =
    item.sceneCategory !== undefined
      ? formatVideoFunnelCategories(
          parseVideoFunnelCategories(item.sceneCategory),
        )
      : undefined;

  if (item.kind === "photo") {
    const data: Record<string, unknown> = {};
    if (displayTitle !== undefined) data.tgDisplayTitle = displayTitle;
    if (notes !== undefined) data.notes = notes;
    if (sceneCategory !== undefined) data.sceneCategory = sceneCategory;
    if (item.previewImageUrl !== undefined) {
      data.previewImageUrl = item.previewImageUrl.trim();
    }
    if (item.previewVideoUrl !== undefined) {
      data.previewVideoUrl = item.previewVideoUrl.trim();
    }
    if (Object.keys(data).length) {
      await prisma.photoTemplate.update({ where: { id: item.id }, data });
    }
    if (item.tgPublished === true) {
      await publishPhotoTemplateToTg(item.id, {
        displayTitle,
        sceneCategory,
      });
    } else if (item.tgPublished === false) {
      await unpublishPhotoTemplateFromTg(item.id);
    }
    return;
  }

  if (item.kind === "video") {
    const data: Record<string, unknown> = {};
    if (displayTitle !== undefined) data.tgDisplayTitle = displayTitle;
    if (notes !== undefined) data.notes = notes;
    if (sceneCategory !== undefined) data.sceneCategory = sceneCategory;
    if (item.previewImageUrl !== undefined) {
      data.previewPhotoUrl = item.previewImageUrl.trim();
    }
    if (item.previewVideoUrl !== undefined) {
      data.previewVideoUrl = item.previewVideoUrl.trim();
    }
    if (Object.keys(data).length) {
      await prisma.quickVideoTemplate.update({ where: { id: item.id }, data });
    }
    if (item.tgPublished === true) {
      await publishQuickVideoTemplateToTg(item.id, { displayTitle });
      if (sceneCategory !== undefined) {
        await prisma.quickVideoTemplate.update({
          where: { id: item.id },
          data: { sceneCategory },
        });
      }
    } else if (item.tgPublished === false) {
      await unpublishQuickVideoTemplateFromTg(item.id);
    }
    return;
  }

  if (item.kind === "lora_i2v") {
    const data: Record<string, unknown> = {};
    if (displayTitle !== undefined) data.tgDisplayTitle = displayTitle;
    if (notes !== undefined) data.notes = notes;
    if (sceneCategory !== undefined) data.sceneCategory = sceneCategory;
    if (item.previewImageUrl !== undefined) {
      data.previewImageUrl = item.previewImageUrl.trim();
    }
    if (item.previewVideoUrl !== undefined) {
      data.previewVideoUrl = item.previewVideoUrl.trim();
    }
    if (Object.keys(data).length) {
      await prisma.loraI2vTemplate.update({ where: { id: item.id }, data });
    }
    if (item.tgPublished === true) {
      await publishLoraI2vTemplateToTg(item.id, {
        displayTitle,
        sceneCategory,
      });
    } else if (item.tgPublished === false) {
      await unpublishLoraI2vTemplateFromTg(item.id);
    }
  }
}
