import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  listTgFeaturedPhotoTemplates,
  listTgFeaturedVideoTemplates,
  videoTemplatePricePeaches,
} from "@/lib/tg/tg-catalog";
import { listTgPublishedLoraI2vTemplates } from "@/lib/lora-i2v-template";
import { priceForLoraI2vTemplate } from "@/lib/template-pricing";
import { normalizeLocale, type TgLocale } from "@/lib/tg/i18n";
import { seedPreviewForPhoto, seedPreviewForVideo } from "@/lib/tg/tg-catalog-seed";
import { isSafeVideoTemplateThumb } from "@/lib/quick-video-preview-safe";
import {
  resolveVideoTemplateSpeech,
  speechSlotsPublicDto,
} from "@/lib/tg/template-speech";
import { extractSpeechSlots, templateHasSpeech } from "@/lib/speech-slots";
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

/** Fire migrate/repair at most once per process — not on every feed open. */
let previewHygieneKickoff = false;
function kickPreviewHygieneOnce() {
  if (previewHygieneKickoff) return;
  previewHygieneKickoff = true;
  void import("@/lib/tg/migrate-video-preview")
    .then((m) => m.migrateVideoTemplatePreviewHygiene())
    .catch((e) => console.error("[peach] video preview migrate:", e));
  void import("@/lib/tg/repair-tg-video-previews")
    .then((m) => m.repairMissingTgVideoPreviews())
    .catch((e) => console.error("[peach] video preview repair:", e));
}

/** Templates feed for TG Mini App. */
export async function GET(req: Request) {
  kickPreviewHygieneOnce();

  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  void import("@/lib/ops/prices")
    .then(({ ensurePriceOverlay }) => ensurePriceOverlay())
    .catch(() => undefined);

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "all";
  const includeSpeech =
    url.searchParams.get("include") === "speech" ||
    url.searchParams.get("includeSpeech") === "1";
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
      const row = t as typeof t & { titleEn?: string; hasSpeech?: boolean };
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

      let hasSpeech = Boolean(row.hasSpeech);
      let speechSlots: ReturnType<typeof speechSlotsPublicDto> | undefined;
      if (includeSpeech) {
        const speech = await resolveVideoTemplateSpeech(t.id);
        hasSpeech = speech.hasSpeech;
        speechSlots = speechSlotsPublicDto(speech.slots, locale);
      }

      return {
        ...t,
        title: videoTitle(row, locale),
        pricePeaches: videoTemplatePricePeaches(t),
        hasSpeech,
        ...(speechSlots ? { speechSlots } : {}),
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

  /** One batch query for lora speech/pricing extras instead of N+1. */
  const loraIds = loraI2vRaw.map((t) => t.id);
  const loraFullRows =
    loraIds.length === 0
      ? []
      : await prisma.loraI2vTemplate.findMany({
          where: { id: { in: loraIds } },
          select: {
            id: true,
            i2vPrompt: true,
            stillPrompt: true,
            shotsJson: true,
          },
        });
  const loraFullById = new Map(loraFullRows.map((r) => [r.id, r]));

  const loraI2v = loraI2vRaw.map((t) => {
    const rawVideo = t.previewVideoUrl?.trim() || "";
    const previewVideo = resolveTgCatalogAssetUrl(
      rawVideo && looksLikeVideoUrl(rawVideo) ? rawVideo : "",
    );
    const previewPhoto = resolveTgCatalogAssetUrl(
      t.previewImageUrl?.trim() || "",
    );
    const full = loraFullById.get(t.id);
    const slotsRaw = extractSpeechSlots(
      full?.i2vPrompt || "",
      full?.stillPrompt || "",
    );
    const hasSpeech = templateHasSpeech(slotsRaw);
    const speechSlots = includeSpeech
      ? speechSlotsPublicDto(slotsRaw, locale)
      : undefined;

    return {
      id: t.id,
      title: t.title,
      notes: t.notes,
      pricePeaches: priceForLoraI2vTemplate(t.durationSec, {
        shotsJson: full?.shotsJson || "",
      }),
      durationSec: t.durationSec,
      previewVideoUrl: previewVideo,
      previewPhotoUrl: previewPhoto,
      hasSpeech,
      ...(speechSlots ? { speechSlots } : {}),
      templateKind: "lora_i2v" as const,
      requiresLora: true,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      identityKey: t.identityKey || t.id,
    };
  });

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
