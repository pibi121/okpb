import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  listTgFeaturedPhotoTemplates,
  listTgFeaturedVideoTemplates,
  videoTemplatePricePeaches,
} from "@/lib/tg/tg-catalog";
import { listTgPublishedLoraI2vTemplates } from "@/lib/lora-i2v-template";
import { normalizeLocale, type TgLocale } from "@/lib/tg/i18n";
import { seedPreviewForPhoto, seedPreviewForVideo } from "@/lib/tg/tg-catalog-seed";
import { isSafeVideoTemplateThumb } from "@/lib/quick-video-preview-safe";
import {
  resolveVideoTemplateSpeech,
  speechSlotsPublicDto,
} from "@/lib/tg/template-speech";
import { extractSpeechSlots } from "@/lib/speech-slots";
import { resolveTgCatalogAssetUrl } from "@/lib/tg/catalog-asset-url";
import { shuffleInPlace } from "@/lib/tg/feed-order";

function videoTitle(
  row: { title: string; titleEn?: string },
  locale: TgLocale,
) {
  return locale === "en" && row.titleEn?.trim() ? row.titleEn : row.title;
}

function looksLikeVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || /preview/i.test(url);
}

/** Templates feed for TG Mini App. */
export async function GET(req: Request) {
  void import("@/lib/tg/migrate-video-preview")
    .then((m) => m.migrateVideoTemplatePreviewHygiene())
    .catch((e) => console.error("[peach] video preview migrate:", e));
  void import("@/lib/tg/repair-tg-video-previews")
    .then((m) => m.repairMissingTgVideoPreviews())
    .catch((e) => console.error("[peach] video preview repair:", e));

  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "all";
  const localeParam = url.searchParams.get("locale");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const locale = normalizeLocale(localeParam || user?.locale);

  const [videoRaw, photo, loraI2vRaw] = await Promise.all([
    kind === "photo" ? Promise.resolve([]) : listTgFeaturedVideoTemplates(userId),
    kind === "video" ? Promise.resolve([]) : listTgFeaturedPhotoTemplates(locale),
    kind === "photo"
      ? Promise.resolve([])
      : listTgPublishedLoraI2vTemplates(locale),
  ]);

  const video = await Promise.all(
    videoRaw.map(async (t, i) => {
      const row = t as typeof t & { titleEn?: string };
      const seedPrev = seedPreviewForVideo(row.title, i);
      const rawVideo = t.previewVideoUrl?.trim() || "";
      const previewVideo = resolveTgCatalogAssetUrl(
        (rawVideo && looksLikeVideoUrl(rawVideo) ? rawVideo : "") ||
          seedPrev?.previewVideoUrl ||
          "",
      );
      const rawPhoto = t.previewPhotoUrl?.trim() || "";
      const previewPhoto = resolveTgCatalogAssetUrl(
        isSafeVideoTemplateThumb(rawPhoto)
          ? rawPhoto
          : isSafeVideoTemplateThumb(seedPrev?.previewPhotoUrl)
            ? seedPrev!.previewPhotoUrl
            : "",
      );
      const speech = await resolveVideoTemplateSpeech(t.id);
      const slots = speechSlotsPublicDto(speech.slots, locale);
      return {
        ...t,
        title: videoTitle(row, locale),
        pricePeaches: videoTemplatePricePeaches(t),
        hasSpeech: speech.hasSpeech,
        speechSlots: slots,
        previewVideoUrl: previewVideo,
        previewPhotoUrl: previewPhoto,
        templateKind: "quick_video" as const,
        requiresLora: false,
        createdAt:
          (t as { createdAt?: string }).createdAt || new Date(0).toISOString(),
        updatedAt:
          (t as { updatedAt?: string }).updatedAt ||
          (t as { createdAt?: string }).createdAt ||
          new Date(0).toISOString(),
        identityKey: (t as { identityKey?: string }).identityKey || t.id,
      };
    }),
  );

  const loraI2v = await Promise.all(
    loraI2vRaw.map(async (t) => {
      const rawVideo = t.previewVideoUrl?.trim() || "";
      const previewVideo = resolveTgCatalogAssetUrl(
        rawVideo && looksLikeVideoUrl(rawVideo) ? rawVideo : "",
      );
      const previewPhoto = resolveTgCatalogAssetUrl(
        t.previewImageUrl?.trim() || "",
      );
      const full = await prisma.loraI2vTemplate.findFirst({
        where: { id: t.id },
        select: { i2vPrompt: true, stillPrompt: true },
      });
      const slotsRaw = extractSpeechSlots(
        full?.i2vPrompt || "",
        full?.stillPrompt || "",
      );
      const slots = speechSlotsPublicDto(slotsRaw, locale);
      return {
        id: t.id,
        title: t.title,
        notes: t.notes,
        pricePeaches: t.pricePeaches,
        durationSec: t.durationSec,
        previewVideoUrl: previewVideo,
        previewPhotoUrl: previewPhoto,
        hasSpeech: slots.length > 0,
        speechSlots: slots,
        templateKind: "lora_i2v" as const,
        requiresLora: true,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        identityKey: t.identityKey || t.id,
      };
    }),
  );

  const { resolveVideoLocalPath } = await import(
    "@/lib/quick-video-template-preview"
  );
  const videoWithPreview = video.filter(
    (t) => t.previewVideoUrl && resolveVideoLocalPath(t.previewVideoUrl),
  );
  const loraWithPreview = loraI2v.filter(
    (t) => t.previewVideoUrl && resolveVideoLocalPath(t.previewVideoUrl),
  );

  const photoMapped = photo.map((p) => ({
    ...p,
    previewImageUrl: resolveTgCatalogAssetUrl(
      p.previewImageUrl?.trim() ||
        seedPreviewForPhoto(p.title) ||
        "",
    ),
    createdAt: (p as { createdAt?: string }).createdAt || new Date(0).toISOString(),
    updatedAt:
      (p as { updatedAt?: string }).updatedAt ||
      (p as { createdAt?: string }).createdAt ||
      new Date(0).toISOString(),
    identityKey: (p as { identityKey?: string }).identityKey || p.id,
    sceneCategory: (p as { sceneCategory?: string }).sceneCategory || "",
  }));

  return NextResponse.json({
    // Mix max-quality (lora_i2v) with regular quick videos — no priority order.
    video: shuffleInPlace([...loraWithPreview, ...videoWithPreview]),
    photo: shuffleInPlace([...photoMapped]),
    locale,
  });
}
