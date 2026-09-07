import { prisma } from "@/lib/db";
import { tgPhotoPeaches, type TgPhotoTier } from "@/lib/tg-pricing";
import type { TgLocale } from "@/lib/tg/i18n";

export type PublicPhotoTemplate = {
  id: string;
  title: string;
  notes: string;
  tier: TgPhotoTier;
  pricePeaches: number;
  previewImageUrl: string;
  hasSpeech: boolean;
};

function localizedTitle(
  row: { title: string; titleEn: string },
  locale: TgLocale,
): string {
  return locale === "en" && row.titleEn.trim() ? row.titleEn : row.title;
}

function localizedNotes(
  row: { notes: string; notesEn: string },
  locale: TgLocale,
): string {
  return locale === "en" && row.notesEn.trim() ? row.notesEn : row.notes;
}

export async function listPublicPhotoTemplates(
  locale: TgLocale = "ru",
): Promise<PublicPhotoTemplate[]> {
  const rows = await prisma.photoTemplate.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    title: localizedTitle(r, locale),
    notes: localizedNotes(r, locale),
    tier: (r.tier === "pose" ? "pose" : "basic") as TgPhotoTier,
    pricePeaches:
      r.pricePeaches ||
      tgPhotoPeaches(r.tier === "pose" ? "pose" : "basic"),
    previewImageUrl: r.previewImageUrl || r.sceneImageUrl,
    hasSpeech: r.hasSpeech,
  }));
}

/** Load a photo template usable for TG/bot generation (Peach and/or TG catalog). */
export async function getPhotoTemplate(id: string) {
  return prisma.photoTemplate.findFirst({
    where: {
      id,
      // TG feed uses tgPublished; Peach marketplace uses published.
      // TG-only transfers set published=false — must still generate.
      OR: [{ published: true }, { tgPublished: true }],
    },
  });
}
