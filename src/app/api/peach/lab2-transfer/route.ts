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
import { copyAssetToTgCatalog } from "@/lib/tg/tg-publish";

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

/**
 * Lab 2.0 — перенос в Funnel v2 bot (новая воронка).
 * Не трогает tgPublished / старую воронку / Mini App.
 * Списки: только шаблоны «по 1 фото» (без LoRA).
 */
export async function GET() {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const [photos, videos, loraI2v] = await Promise.all([
    prisma.photoTemplate.findMany({
      orderBy: [
        { funnelV2Published: "desc" },
        { sortOrder: "asc" },
        { updatedAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        title: true,
        notes: true,
        tgDisplayTitle: true,
        funnelV2Published: true,
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
        { funnelV2Published: "desc" },
        { tgSortOrder: "asc" },
        { updatedAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        title: true,
        notes: true,
        tgDisplayTitle: true,
        funnelV2Published: true,
        sceneCategory: true,
        previewPhotoUrl: true,
        previewVideoUrl: true,
        durationSec: true,
        tgSortOrder: true,
        updatedAt: true,
      },
    }),
    // Только one-photo I2V — LoRA-шаблоны в бот-воронку не идут
    prisma.loraI2vTemplate.findMany({
      where: { requiresLora: false },
      orderBy: [
        { funnelV2Published: "desc" },
        { tgSortOrder: "asc" },
        { updatedAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        title: true,
        notes: true,
        tgDisplayTitle: true,
        funnelV2Published: true,
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
      funnelV2Published: r.funnelV2Published,
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
      funnelV2Published: r.funnelV2Published,
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
      funnelV2Published: r.funnelV2Published,
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
  funnelV2Published: z.boolean().optional(),
  displayTitle: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
  sceneCategory: z.string().max(120).optional(),
  previewImageUrl: z.string().max(2000).optional(),
  previewVideoUrl: z.string().max(2000).optional(),
});

const batchSchema = z.object({
  items: z.array(itemPatchSchema).min(1).max(120),
});

/** Batch save — только Funnel v2; tgPublished не меняем. */
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
  const notes =
    item.notes !== undefined ? item.notes.trim().slice(0, 2000) : undefined;
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
    if (item.funnelV2Published !== undefined) {
      data.funnelV2Published = item.funnelV2Published;
      if (item.funnelV2Published) {
        const row = await prisma.photoTemplate.findUnique({
          where: { id: item.id },
        });
        if (row) {
          const slug = `fv2-pt-${item.id.slice(0, 10)}`;
          const img = copyAssetToTgCatalog(
            item.previewImageUrl?.trim() ||
              row.previewImageUrl ||
              row.sceneImageUrl,
            `${slug}-preview`,
            ".jpg",
          );
          if (img) data.previewImageUrl = img;
          const vidSrc = item.previewVideoUrl?.trim() || row.previewVideoUrl;
          if (vidSrc) {
            const vid = copyAssetToTgCatalog(vidSrc, `${slug}-teaser`, ".mp4");
            if (vid) data.previewVideoUrl = vid;
          }
        }
      }
    }
    await prisma.photoTemplate.update({ where: { id: item.id }, data });
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
    if (item.funnelV2Published !== undefined) {
      data.funnelV2Published = item.funnelV2Published;
      if (item.funnelV2Published) {
        const row = await prisma.quickVideoTemplate.findUnique({
          where: { id: item.id },
        });
        if (row) {
          const slug = `fv2-qv-${item.id.slice(0, 10)}`;
          const vidSrc = item.previewVideoUrl?.trim() || row.previewVideoUrl;
          if (vidSrc) {
            const vid = copyAssetToTgCatalog(vidSrc, `${slug}-preview`, ".mp4");
            if (vid) data.previewVideoUrl = vid;
          }
          const imgSrc = item.previewImageUrl?.trim() || row.previewPhotoUrl;
          if (imgSrc) {
            const img = copyAssetToTgCatalog(imgSrc, `${slug}-thumb`, ".jpg");
            if (img) data.previewPhotoUrl = img;
          }
        }
      }
    }
    await prisma.quickVideoTemplate.update({ where: { id: item.id }, data });
    return;
  }

  if (item.kind === "lora_i2v") {
    const existing = await prisma.loraI2vTemplate.findFirst({
      where: { id: item.id, requiresLora: false },
    });
    if (!existing) {
      throw new Error("Только шаблоны по 1 фото (без LoRA)");
    }
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
    if (item.funnelV2Published !== undefined) {
      data.funnelV2Published = item.funnelV2Published;
      if (item.funnelV2Published) {
        const slug = `fv2-li2v-${item.id.slice(0, 10)}`;
        const vidSrc = item.previewVideoUrl?.trim() || existing.previewVideoUrl;
        if (vidSrc) {
          const vid = copyAssetToTgCatalog(vidSrc, `${slug}-preview`, ".mp4");
          if (vid) data.previewVideoUrl = vid;
        }
        const imgSrc = item.previewImageUrl?.trim() || existing.previewImageUrl;
        if (imgSrc) {
          const img = copyAssetToTgCatalog(imgSrc, `${slug}-thumb`, ".jpg");
          if (img) data.previewImageUrl = img;
        }
      }
    }
    await prisma.loraI2vTemplate.update({ where: { id: item.id }, data });
  }
}
