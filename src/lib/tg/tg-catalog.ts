/**
 * TG bot + Mini App featured catalog (templates & studio cast sync).
 */
import { prisma } from "@/lib/db";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { seedCastCoverUrl } from "@/lib/tg/tg-catalog-seed";
import { studioCastCoverUrl } from "@/lib/tg/tg-static-previews";
import { resolveStudioCastCoverUrl } from "@/lib/tg/studio-cast";
import type { TgLocale } from "@/lib/tg/i18n";
import { ensureTgBootstrap } from "@/lib/tg/tg-bootstrap";
import { listPublicPhotoTemplates } from "@/lib/photo-template";
import {
  listPublishedQuickVideoTemplates,
  userOwnsTemplate,
  type PublicQuickVideoTemplate,
} from "@/lib/quick-video-template";
import { storyH3Peaches } from "@/lib/tg-pricing";
import { tgTemplateDisplayTitle } from "@/lib/tg/tg-publish";
import { pickCatalogPosterUrl } from "@/lib/quick-video-preview-safe";
import {
  TG_FEATURED_PHOTO_TITLES,
  TG_FEATURED_VIDEO_TITLES,
} from "@/lib/tg/tg-launch-constants";

export {
  TG_FEATURED_PHOTO_TITLES,
  TG_FEATURED_VIDEO_TITLES,
  TG_STUDIO_CAST_NAMES,
  TG_STUDIO_CAST_SPEC,
  TG_STUDIO_CAST_TRIGGERS,
} from "@/lib/tg/tg-launch-constants";

function envIds(key: "TG_FEATURED_VIDEO_IDS" | "TG_FEATURED_PHOTO_IDS"): string[] {
  const raw = process.env[key]?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Idempotent DB fixes: legacy featured titles + tgPublished flags. */
export async function ensureTgCatalog(): Promise<void> {
  const { migrateTemplateIdentityHygiene } = await import(
    "@/lib/tg/migrate-template-identity"
  );
  await migrateTemplateIdentityHygiene().catch((e) =>
    console.error("[peach] template identity migrate:", e),
  );

  const uncategorized = await prisma.photoTemplate.findMany({
    where: { sceneCategory: "" },
    select: { id: true, title: true },
  });
  const { guessPhotoSceneCategory } = await import("@/lib/tg/feed-order");
  for (const row of uncategorized) {
    const cat = guessPhotoSceneCategory(row.title);
    if (!cat) continue;
    await prisma.photoTemplate.update({
      where: { id: row.id },
      data: { sceneCategory: cat },
    });
  }

  for (const title of TG_FEATURED_VIDEO_TITLES) {
    await prisma.quickVideoTemplate.updateMany({
      where: { title },
      data: {
        published: true,
        tgPublished: true,
        isJuice: false,
        pricePeaches: 0,
        priceCredits: 0,
      },
    });
  }

  const photoFeatured = await prisma.photoTemplate.findFirst({
    where: { title: { in: [...TG_FEATURED_PHOTO_TITLES] } },
  });
  if (!photoFeatured) {
    const legacy = await prisma.photoTemplate.findFirst({
      where: {
        OR: [{ title: "2" }, { editPrompt: { contains: "titjob" } }],
      },
      orderBy: { createdAt: "desc" },
    });
    if (legacy) {
      await prisma.photoTemplate.update({
        where: { id: legacy.id },
        data: {
          title: TG_FEATURED_PHOTO_TITLES[0]!,
          published: true,
          tgPublished: true,
          sortOrder: 0,
        },
      });
    }
  } else {
    await prisma.photoTemplate.update({
      where: { id: photoFeatured.id },
      data: { published: true, tgPublished: true, sortOrder: 0 },
    });
  }
}

function orderByTitles<T extends { title: string; id?: string }>(
  rows: T[],
  titles: readonly string[],
): T[] {
  const out: T[] = [];
  for (const title of titles) {
    const row = rows.find((r) => r.title === title);
    if (row) out.push(row);
  }
  return out;
}

function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter(Boolean) as T[];
}

async function listTgPublishedVideoRows(userId: string): Promise<PublicQuickVideoTemplate[]> {
  const rows = await prisma.quickVideoTemplate.findMany({
    // TG feed is gated by tgPublished only — Peach marketplace uses `published`.
    where: { tgPublished: true },
    orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
  });
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const purchases = await prisma.quickVideoTemplatePurchase.findMany({
    where: { userId, templateId: { in: ids } },
    select: { templateId: true },
  });
  const ownedSet = new Set(purchases.map((p) => p.templateId));

  return rows.map((r) => {
    const isAuthor = r.userId === userId;
    const purchased = ownedSet.has(r.id);
    const owned = userOwnsTemplate({
      isAuthor,
      isJuice: r.isJuice,
      priceCredits: r.priceCredits,
      purchased,
    });
    return {
      id: r.id,
      title: tgTemplateDisplayTitle(r),
      notes: r.notes,
      category: r.category as PublicQuickVideoTemplate["category"],
      isJuice: r.isJuice,
      priceCredits: r.priceCredits,
      identityPersonCount: r.identityPersonCount,
      hasLocationSlot: r.hasLocationSlot,
      previewVideoUrl: r.previewVideoUrl,
      previewPhotoUrl: pickCatalogPosterUrl(r.previewPhotoUrl),
      orientation: r.orientation,
      durationSec: r.durationSec,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      identityKey: r.previewIdentityKey || r.userId || r.id,
      owned,
      isAuthor,
    };
  });
}

async function listTgPublishedPhotoRows(locale: TgLocale) {
  const rows = await prisma.photoTemplate.findMany({
    where: { tgPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  if (!rows.length) return [];

  const { tgPhotoPeaches } = await import("@/lib/tg-pricing");
  const localizedTitle = (
    row: { title: string; titleEn: string; tgDisplayTitle: string },
  ) => {
    const base =
      locale === "en" && row.titleEn.trim() ? row.titleEn : row.title;
    return row.tgDisplayTitle.trim() || base;
  };
  const localizedNotes = (row: { notes: string; notesEn: string }) =>
    locale === "en" && row.notesEn.trim() ? row.notesEn : row.notes;

  return rows.map((r) => ({
    id: r.id,
    title: localizedTitle(r),
    notes: localizedNotes(r),
    tier: (r.tier === "pose" ? "pose" : "basic") as "basic" | "pose",
    pricePeaches:
      r.pricePeaches || tgPhotoPeaches(r.tier === "pose" ? "pose" : "basic"),
    previewImageUrl: r.previewImageUrl || r.sceneImageUrl,
    hasSpeech: r.hasSpeech,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    identityKey: r.previewIdentityKey || r.id,
    sceneCategory: r.sceneCategory || "",
  }));
}

export async function listTgFeaturedVideoTemplates(
  userId: string,
): Promise<PublicQuickVideoTemplate[]> {
  await ensureTgBootstrap();
  await ensureTgCatalog();

  const published = await listTgPublishedVideoRows(userId);
  if (published.length) return published;

  const all = await listPublishedQuickVideoTemplates(userId);

  const byEnv = envIds("TG_FEATURED_VIDEO_IDS");
  if (byEnv.length) {
    const picked = orderByIds(all, byEnv);
    if (picked.length) return picked;
  }

  const botIds = process.env.TG_BOT_INLINE_TEMPLATE_IDS?.trim();
  if (botIds) {
    const ids = botIds.split(",").map((s) => s.trim()).filter(Boolean);
    const picked = orderByIds(all, ids);
    if (picked.length) return picked;
  }

  const byTitle = orderByTitles(all, TG_FEATURED_VIDEO_TITLES);
  if (byTitle.length) return byTitle;

  const fuzzy = all.filter(
    (t) =>
      /сосёт|кончает/i.test(t.title) ||
      /снимает.*одежд|верхн.*одежд/i.test(t.title),
  );
  if (fuzzy.length) return fuzzy.slice(0, 2);

  return all.slice(0, 2);
}

export async function listTgFeaturedPhotoTemplates(locale: TgLocale = "ru") {
  await ensureTgBootstrap();
  await ensureTgCatalog();

  const published = await listTgPublishedPhotoRows(locale);
  if (published.length) return published;

  const all = await listPublicPhotoTemplates(locale);

  const byEnv = envIds("TG_FEATURED_PHOTO_IDS");
  if (byEnv.length) {
    const picked = orderByIds(all, byEnv);
    if (picked.length) return picked;
  }

  const byTitle = orderByTitles(all, TG_FEATURED_PHOTO_TITLES);
  if (byTitle.length) return byTitle;

  const fuzzy = all.filter((t) => /член.*рту|во рту/i.test(t.title));
  if (fuzzy.length) return fuzzy.slice(0, 1);

  return all.slice(0, 1);
}

export function videoTemplatePricePeaches(t: PublicQuickVideoTemplate): number {
  const row = t as PublicQuickVideoTemplate & { pricePeaches?: number };
  if (row.pricePeaches && row.pricePeaches > 0) return row.pricePeaches;
  if (t.priceCredits > 0) return t.priceCredits;
  // Featured TG clips are Story H3 by default; charging path may upgrade to premium.
  return storyH3Peaches(t.durationSec || 6);
}

/** Random gallery still for studio cast card cover. */
export async function pickCharacterCoverUrl(
  characterId: string,
): Promise<string | null> {
  const ch = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      triggerWord: true,
      isStudioCast: true,
      tgCoverUrl: true,
      name: true,
    },
  });
  if (ch) {
    const resolved = resolveStudioCastCoverUrl(ch);
    if (resolved) return resolved;
  }
  if (ch?.isStudioCast) {
    return (
      seedCastCoverUrl(ch.triggerWord) ||
      studioCastCoverUrl(ch.triggerWord)
    );
  }

  const rows = await prisma.galleryItem.findMany({
    where: {
      characterId,
      kind: "photo",
      resultUrl: { not: "" },
      NOT: { resultUrl: GALLERY_PLACEHOLDER_URL },
    },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: { resultUrl: true, metaJson: true },
  });
  const valid = rows.filter((r) => {
    if (r.resultUrl.startsWith("data:image/svg")) return false;
    try {
      const m = JSON.parse(r.metaJson || "{}") as { mock?: boolean };
      if (m.mock && r.resultUrl === GALLERY_PLACEHOLDER_URL) return false;
    } catch {
      /* ignore */
    }
    return true;
  });
  if (!valid.length) {
    return (
      seedCastCoverUrl(ch?.triggerWord) ||
      studioCastCoverUrl(ch?.triggerWord)
    );
  }
  const pick = valid[Math.floor(Math.random() * valid.length)]!;
  return pick.resultUrl;
}
