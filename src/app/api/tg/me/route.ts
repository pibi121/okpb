import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { listTgCharacters, listVideoRefCharacters } from "@/lib/tg/character-service";
import { listStudioCasts, hasRealCharacterLora } from "@/lib/tg/studio-cast";
import { pickCharacterCoverUrl } from "@/lib/tg/tg-catalog";
import { normalizeLocale } from "@/lib/tg/i18n";
import { listFavoriteCastIds } from "@/lib/tg/cast-favorites";
import { TG_PROMO, TG_PREMIUM } from "@/lib/tg-pricing";
import {
  TG_MAX_LORA_PHOTOS,
  TG_MIN_LORA_PHOTOS,
  characterPhotoCount,
} from "@/lib/tg/character-service";
import { buildTgTrainProgress } from "@/lib/tg/train-progress";

/** Mini App profile: balance, characters, studio cast, promos. */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const locale = normalizeLocale(url.searchParams.get("locale"));

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  void import("@/lib/tg/migrate-user-lora-lookbook")
    .then((m) => m.migrateUserLoraLookbookOverlayOff())
    .catch((e) => console.error("[peach] lookbook migrate:", e));

  const [characters, casts, videoRefs, favoriteCastIds] = await Promise.all([
    listTgCharacters(userId),
    listStudioCasts(locale),
    listVideoRefCharacters(userId),
    listFavoriteCastIds(userId),
  ]);

  // Covers: only for a few personal cards — avoid N gallery scans on every open.
  const personal = characters.filter((c) => !c.isStudioCast).slice(0, 8);
  const coverEntries = await Promise.all(
    personal.map(async (c) => [c.id, await pickCharacterCoverUrl(c.id)] as const),
  );
  const covers = new Map(coverEntries);

  const charactersWithCovers = characters.map((c) => ({
    id: c.id,
    name: c.name,
    loraStatus: c.loraStatus,
    // Disk is source of truth (DB photoCount can lag after Mini App uploads).
    photoCount: characterPhotoCount(c.id) || c.photoCount,
    isStudioCast: c.isStudioCast,
    videoRefOnly: false,
    coverUrl: c.isStudioCast ? null : covers.get(c.id) ?? null,
    loraUsable: hasRealCharacterLora(c),
    needsGpuTrain:
      !c.isStudioCast &&
      c.loraStatus === "lora_ready" &&
      !hasRealCharacterLora(c),
    train:
      !c.isStudioCast && c.loraStatus === "lora_training"
        ? buildTgTrainProgress(c.id, c.loraStatus)
        : undefined,
  }));

  return NextResponse.json({
    balancePeaches: user.balancePeaches,
    locale: normalizeLocale(user.locale || locale),
    promos: {
      studioDailyFreeReady: user.tgStudioFreeReady,
      loraWelcomePhotosLeft: user.tgLoraWelcomePhotosLeft,
      firstVideoDiscountAvailable: !user.tgFirstVideoDiscountUsed,
      firstVideoDiscountPct: TG_PROMO.firstVideoDiscountPct,
    },
    train: {
      pricePeaches: TG_PREMIUM.loraTrainPeaches,
      minPhotos: TG_MIN_LORA_PHOTOS,
      maxPhotos: TG_MAX_LORA_PHOTOS,
    },
    botUsername: (
      process.env.TELEGRAM_BOT_PUBLIC_URL || "https://t.me/peachbibot"
    ).match(/t\.me\/([A-Za-z0-9_]+)/i)?.[1] || "peachbibot",
    characters: charactersWithCovers,
    videoRefs: videoRefs.map((c) => ({
      id: c.id,
      name: c.name,
      photoCount: c.photoCount,
      videoRefOnly: true,
    })),
    casts,
    favoriteCastIds,
  });
}
