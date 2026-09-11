import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labAccess } from "@/lib/ops/roles";
import { resolveTgCatalogAssetUrl } from "@/lib/tg/catalog-asset-url";
import { resolveVideoLocalPath } from "@/lib/quick-video-template-preview";

export const runtime = "nodejs";

function firstUrl(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const u = (c || "").trim();
    if (u) return u;
  }
  return "";
}

function previewMissing(videoUrl: string, imageUrl: string, kind: string): boolean {
  if (kind === "photo") {
    return !imageUrl.trim();
  }
  const v = videoUrl.trim();
  if (!v) return true;
  return !resolveVideoLocalPath(v);
}

/** Lab: all TG template formats (photo / video / video-from-photo). */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  if (!labAccess(row?.adminRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [photos, videos, loraI2v] = await Promise.all([
    prisma.photoTemplate.findMany({
      orderBy: [{ tgPublished: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        tgPublished: true,
        published: true,
        pricePeaches: true,
        previewImageUrl: true,
        sceneImageUrl: true,
        sortOrder: true,
        updatedAt: true,
      },
    }),
    prisma.quickVideoTemplate.findMany({
      orderBy: [{ tgPublished: "desc" }, { tgSortOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        tgPublished: true,
        published: true,
        pricePeaches: true,
        previewVideoUrl: true,
        previewPhotoUrl: true,
        durationSec: true,
        tgSortOrder: true,
        updatedAt: true,
      },
    }),
    prisma.loraI2vTemplate.findMany({
      orderBy: [{ tgPublished: "desc" }, { tgSortOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        tgPublished: true,
        published: true,
        pricePeaches: true,
        previewVideoUrl: true,
        previewImageUrl: true,
        durationSec: true,
        tgSortOrder: true,
        updatedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    items: [
      ...photos.map((r) => {
        const previewUrl = resolveTgCatalogAssetUrl(
          firstUrl(r.previewImageUrl, r.sceneImageUrl),
        );
        return {
          kind: "photo" as const,
          id: r.id,
          title: r.title,
          displayTitle: r.tgDisplayTitle || "",
          tgPublished: r.tgPublished,
          published: r.published,
          pricePeaches: r.pricePeaches,
          sortOrder: r.sortOrder,
          durationSec: 0,
          previewUrl,
          previewVideoUrl: "",
          previewMissing: previewMissing("", previewUrl, "photo"),
          labHref: `/peach/photo`,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
      ...videos.map((r) => {
        const previewVideoUrl = resolveTgCatalogAssetUrl(r.previewVideoUrl);
        return {
          kind: "video" as const,
          id: r.id,
          title: r.title,
          displayTitle: r.tgDisplayTitle || "",
          tgPublished: r.tgPublished,
          published: r.published,
          pricePeaches: r.pricePeaches,
          sortOrder: r.tgSortOrder,
          durationSec: r.durationSec,
          previewUrl: resolveTgCatalogAssetUrl(firstUrl(r.previewPhotoUrl)),
          previewVideoUrl,
          previewMissing: previewMissing(r.previewVideoUrl, "", "video"),
          labHref: `/peach/video?tab=create&qvTemplate=${r.id}`,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
      ...loraI2v.map((r) => {
        const previewVideoUrl = resolveTgCatalogAssetUrl(r.previewVideoUrl);
        return {
          kind: "lora_i2v" as const,
          id: r.id,
          title: r.title,
          displayTitle: r.tgDisplayTitle || "",
          tgPublished: r.tgPublished,
          published: r.published,
          pricePeaches: r.pricePeaches,
          sortOrder: r.tgSortOrder,
          durationSec: r.durationSec,
          previewUrl: resolveTgCatalogAssetUrl(firstUrl(r.previewImageUrl)),
          previewVideoUrl,
          previewMissing: previewMissing(r.previewVideoUrl, "", "lora_i2v"),
          labHref: `/peach/lora-i2v?templateId=${r.id}`,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    ],
  });
}
