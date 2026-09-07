/**
 * Publish Peach templates & studio cast cards to Telegram bot + Mini App.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { localPathFromResultUrl } from "@/lib/local-store";
import { ensureDataDirs, galleryRoot } from "@/lib/paths";
import { ensureTgCatalog } from "@/lib/tg/tg-catalog";
import { TG_STUDIO_CAST_TRIGGERS } from "@/lib/tg/tg-launch-constants";

const PUBLIC_CATALOG_DIR = path.join(process.cwd(), "public", "tg", "catalog");

function extFromUrl(url: string, fallback: string): string {
  const base = url.split("?")[0] || "";
  const ext = path.extname(base);
  return ext || (fallback.startsWith(".") ? fallback : `.${fallback}`);
}

/**
 * Copy gallery/public asset to durable TG catalog on the Railway volume
 * (`data/gallery/tg-catalog`) and mirror into public/ for static fallback.
 */
export function copyAssetToTgCatalog(
  srcUrl: string,
  destBaseName: string,
  fallbackExt: string,
): string {
  if (!srcUrl?.trim()) return "";
  ensureDataDirs();
  const ext = extFromUrl(srcUrl, fallbackExt);
  const destName = `${destBaseName}${ext}`;
  const durableDir = path.join(galleryRoot(), "tg-catalog");
  fs.mkdirSync(durableDir, { recursive: true });
  fs.mkdirSync(PUBLIC_CATALOG_DIR, { recursive: true });
  const durablePath = path.join(durableDir, destName);
  const publicPath = path.join(PUBLIC_CATALOG_DIR, destName);
  // Volume-backed URL survives redeploys; public mirror helps local/dev.
  const publicUrl = `/api/media/tg-catalog/${destName}`;

  const writeBoth = (srcPath: string) => {
    fs.copyFileSync(srcPath, durablePath);
    try {
      fs.copyFileSync(srcPath, publicPath);
    } catch {
      /* public may be read-only in some envs */
    }
  };

  const local = localPathFromResultUrl(srcUrl);
  if (local && fs.existsSync(local)) {
    writeBoth(local);
    return publicUrl;
  }

  if (srcUrl.startsWith("/tg/catalog/")) {
    const name = srcUrl.replace(/^\/tg\/catalog\//, "").split("?")[0] || "";
    const fromPublic = path.join(PUBLIC_CATALOG_DIR, name);
    const fromDurable = path.join(durableDir, name);
    if (fs.existsSync(fromDurable)) {
      writeBoth(fromDurable);
      return publicUrl;
    }
    if (fs.existsSync(fromPublic)) {
      writeBoth(fromPublic);
      return publicUrl;
    }
    return srcUrl;
  }

  if (srcUrl.startsWith("/api/media/")) {
    const key = srcUrl.replace(/^\/api\/media\//, "").split("?")[0] || "";
    const fromGallery = path.join(galleryRoot(), ...key.split("/"));
    if (fs.existsSync(fromGallery)) {
      writeBoth(fromGallery);
      return publicUrl;
    }
  }

  if (srcUrl.startsWith("/")) {
    const fromPublicRoot = path.join(process.cwd(), "public", srcUrl);
    if (fs.existsSync(fromPublicRoot)) {
      writeBoth(fromPublicRoot);
      return publicUrl;
    }
  }

  return srcUrl;
}

export function tgTemplateDisplayTitle(row: {
  title: string;
  tgDisplayTitle?: string | null;
}): string {
  const custom = row.tgDisplayTitle?.trim();
  return custom || row.title;
}

export function tgCastDisplayName(row: {
  name: string;
  tgDisplayName?: string | null;
}): string {
  const custom = row.tgDisplayName?.trim();
  return custom || row.name;
}

export async function publishQuickVideoTemplateToTg(
  templateId: string,
  opts?: { displayTitle?: string },
) {
  const row = await prisma.quickVideoTemplate.findUnique({ where: { id: templateId } });
  if (!row) throw new Error("Шаблон не найден");

  const { ensureTemplatePreviewPhoto, isSafeVideoTemplateThumb } = await import(
    "@/lib/quick-video-template-preview"
  );
  const safeThumb = await ensureTemplatePreviewPhoto(row, {
    force: !isSafeVideoTemplateThumb(row.previewPhotoUrl),
    atSec: 1,
  });
  const fresh = await prisma.quickVideoTemplate.findUnique({
    where: { id: templateId },
  });
  if (!fresh) throw new Error("Шаблон не найден");

  const slug = `qv-${templateId.slice(0, 10)}`;
  const previewVideoUrl = copyAssetToTgCatalog(
    fresh.previewVideoUrl,
    `${slug}-preview`,
    ".mp4",
  );
  // Use -frame-thumb so old leaked qv-*-thumb.jpg copies are not reused as posters.
  const previewPhotoUrl = safeThumb
    ? copyAssetToTgCatalog(safeThumb, `${slug}-frame-thumb`, ".png")
    : "";

  const displayTitle = opts?.displayTitle?.trim() ?? fresh.tgDisplayTitle;

  const updated = await prisma.quickVideoTemplate.update({
    where: { id: templateId },
    data: {
      tgPublished: true,
      // Do not force Peach `published` — TG-only templates stay off marketplace.
      tgDisplayTitle: displayTitle,
      previewVideoUrl: previewVideoUrl || fresh.previewVideoUrl,
      previewPhotoUrl: previewPhotoUrl || safeThumb || "",
      pricePeaches: fresh.pricePeaches || 0,
      isJuice: false,
      priceCredits: 0,
    },
  });

  await ensureTgCatalog();
  return updated;
}

export async function unpublishQuickVideoTemplateFromTg(templateId: string) {
  return prisma.quickVideoTemplate.update({
    where: { id: templateId },
    data: { tgPublished: false },
  });
}

export async function updateQuickVideoTemplateTgMeta(
  templateId: string,
  patch: { displayTitle?: string; sortOrder?: number },
) {
  const data: { tgDisplayTitle?: string; tgSortOrder?: number } = {};
  if (patch.displayTitle !== undefined) {
    data.tgDisplayTitle = patch.displayTitle.trim();
  }
  if (patch.sortOrder !== undefined) {
    data.tgSortOrder = patch.sortOrder;
  }
  return prisma.quickVideoTemplate.update({ where: { id: templateId }, data });
}

export async function publishPhotoTemplateToTg(
  templateId: string,
  opts?: { displayTitle?: string; sceneCategory?: string },
) {
  const row = await prisma.photoTemplate.findUnique({ where: { id: templateId } });
  if (!row) throw new Error("Шаблон не найден");

  const slug = `pt-${templateId.slice(0, 10)}`;
  const previewImageUrl = copyAssetToTgCatalog(
    row.previewImageUrl || row.sceneImageUrl,
    `${slug}-preview`,
    ".jpg",
  );
  const sceneImageUrl = copyAssetToTgCatalog(
    row.sceneImageUrl || row.previewImageUrl,
    `${slug}-scene`,
    ".jpg",
  );

  const displayTitle = opts?.displayTitle?.trim() ?? row.tgDisplayTitle;

  const updated = await prisma.photoTemplate.update({
    where: { id: templateId },
    data: {
      tgPublished: true,
      // Do not force Peach `published` — TG-only templates stay off marketplace.
      tgDisplayTitle: displayTitle,
      previewImageUrl: previewImageUrl || row.previewImageUrl,
      sceneImageUrl: sceneImageUrl || row.sceneImageUrl,
      ...(opts?.sceneCategory !== undefined
        ? { sceneCategory: opts.sceneCategory }
        : {}),
    },
  });

  await ensureTgCatalog();
  return updated;
}

export async function unpublishPhotoTemplateFromTg(templateId: string) {
  return prisma.photoTemplate.update({
    where: { id: templateId },
    data: { tgPublished: false },
  });
}

export async function updatePhotoTemplateTgMeta(
  templateId: string,
  patch: {
    displayTitle?: string;
    sortOrder?: number;
    sceneCategory?: string;
  },
) {
  const data: {
    tgDisplayTitle?: string;
    sortOrder?: number;
    sceneCategory?: string;
  } = {};
  if (patch.displayTitle !== undefined) {
    data.tgDisplayTitle = patch.displayTitle.trim();
  }
  if (patch.sortOrder !== undefined) {
    data.sortOrder = patch.sortOrder;
  }
  if (patch.sceneCategory !== undefined) {
    data.sceneCategory = patch.sceneCategory;
  }
  return prisma.photoTemplate.update({ where: { id: templateId }, data });
}

export async function updateStudioCastTgCard(
  characterId: string,
  patch: { displayName?: string; coverUrl?: string },
) {
  let ch = await prisma.character.findFirst({
    where: { id: characterId, isStudioCast: true },
  });
  if (!ch) {
    ch = await prisma.character.findFirst({
      where: { id: characterId, triggerWord: { in: TG_STUDIO_CAST_TRIGGERS } },
    });
    if (ch) {
      await prisma.character.update({
        where: { id: ch.id },
        data: { isStudioCast: true },
      });
    }
  }
  if (!ch) throw new Error("Актриса студии не найдена");

  const data: { tgDisplayName?: string; tgCoverUrl?: string } = {};
  if (patch.displayName !== undefined) {
    data.tgDisplayName = patch.displayName.trim();
  }
  if (patch.coverUrl !== undefined) {
    if (patch.coverUrl.trim()) {
      const slug = `cast-${characterId.slice(0, 10)}`;
      const copied = copyAssetToTgCatalog(patch.coverUrl.trim(), slug, ".jpg");
      data.tgCoverUrl = copied
        ? `${copied}${copied.includes("?") ? "&" : "?"}v=${Date.now()}`
        : "";
    } else {
      data.tgCoverUrl = "";
    }
  }

  return prisma.character.update({ where: { id: characterId }, data });
}
