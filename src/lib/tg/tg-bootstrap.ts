/**
 * Idempotent TG launch catalog seed — uses bundled cabinet exports
 * (public/tg/catalog + tg-catalog-seed.json). Re-sync: npm run sync:tg-catalog
 */
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { suggestedLookbook } from "@/lib/lookbook";
import { TG_STUDIO_CAST_SPEC } from "@/lib/tg/tg-launch-constants";
import { getTgCatalogSeed } from "@/lib/tg/tg-catalog-seed";

const STUDIO_OWNER_EMAIL = "tg-studio@peachbitch.internal";

let bootstrapPromise: Promise<void> | null = null;

async function ensureStudioOwnerUserId(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: STUDIO_OWNER_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  return prisma.user
    .create({
      data: {
        email: STUDIO_OWNER_EMAIL,
        passwordHash: await hashPassword(`studio-${process.env.AUTH_SECRET || "internal"}`),
        name: "PeachBitch Studio",
        source: "web",
        ageConfirmed: true,
      },
      select: { id: true },
    })
    .then((u) => u.id);
}

async function ensureStudioCastCharacters(): Promise<void> {
  const ownerId = await ensureStudioOwnerUserId();

  for (const spec of TG_STUDIO_CAST_SPEC) {
    const hit =
      (await prisma.character.findFirst({
        where: { triggerWord: { in: spec.triggers } },
      })) ||
      (await prisma.character.findFirst({
        where: { OR: spec.names.map((name) => ({ name })) },
      }));

    const loraPath =
      spec.triggers[0] === "olh_person"
        ? "krea2/olh_person_krea2.safetensors"
        : spec.triggers[0] === "masha1"
          ? "krea2/masha1_krea2.safetensors"
          : spec.triggers[0] === "daisysh"
            ? "krea2/daisysh_krea2.safetensors"
            : null;

    if (hit) {
      const patch: {
        name?: string;
        loraStatus?: string;
        triggerWord?: string;
        loraPath?: string;
        isStudioCast?: boolean;
        photoCount?: number;
      } = {
        isStudioCast: true,
        loraStatus: "lora_ready",
      };
      if (!hit.triggerWord && spec.triggers[0]) {
        patch.triggerWord = spec.triggers[0];
      }
      if (loraPath && (!hit.loraPath || hit.loraPath.startsWith("mock://"))) {
        patch.loraPath = loraPath;
      }
      if (hit.name !== spec.displayName && !hit.tgDisplayName?.trim()) {
        patch.name = spec.displayName;
      }
      if (hit.loraStatus !== "lora_ready") patch.loraStatus = "lora_ready";
      if (hit.photoCount < 10) patch.photoCount = 25;
      await prisma.character.update({ where: { id: hit.id }, data: patch });
      continue;
    }

    await prisma.character.create({
      data: {
        userId: ownerId,
        name: spec.displayName,
        gender: "female",
        consentGiven: true,
        photoCount: 25,
        status: "ready",
        loraStatus: "lora_ready",
        triggerWord: spec.triggers[0]!,
        loraPath,
        isStudioCast: true,
        lookbookJson: JSON.stringify(
          suggestedLookbook("female", spec.triggers[0] || "olh"),
        ),
      },
    });
  }
}

async function ensureFeaturedTemplates(): Promise<void> {
  const ownerId = await ensureStudioOwnerUserId();
  const seed = getTgCatalogSeed();

  for (const tpl of seed.videos) {
    const existing = await prisma.quickVideoTemplate.findFirst({
      where: { title: tpl.title },
    });
    const previewData = {
      previewVideoUrl: tpl.previewVideoUrl,
      previewPhotoUrl: tpl.previewPhotoUrl,
      shotsJson: tpl.shotsJson,
      slotBlueprintJson: tpl.slotBlueprintJson,
      identityPersonCount: tpl.identityPersonCount,
      durationSec: tpl.durationSec,
      published: true,
      pricePeaches: 0,
      priceCredits: 0,
    };

    if (existing) {
      await prisma.quickVideoTemplate.update({
        where: { id: existing.id },
        data: {
          ...previewData,
          // Keep cabinet previews if they exist and are not api/media stubs on prod
          previewVideoUrl:
            existing.previewVideoUrl?.includes("/tg/catalog/") ||
            !existing.previewVideoUrl?.trim()
              ? tpl.previewVideoUrl
              : existing.previewVideoUrl.startsWith("/api/media/")
                ? tpl.previewVideoUrl
                : existing.previewVideoUrl,
          previewPhotoUrl:
            existing.previewPhotoUrl?.includes("/tg/catalog/") ||
            !existing.previewPhotoUrl?.trim()
              ? tpl.previewPhotoUrl
              : existing.previewPhotoUrl.startsWith("/api/media/")
                ? tpl.previewPhotoUrl
                : existing.previewPhotoUrl,
        },
      });
      continue;
    }

    await prisma.quickVideoTemplate.create({
      data: {
        userId: ownerId,
        title: tpl.title,
        category: "bitch",
        isJuice: false,
        orientation: "9_16",
        ...previewData,
      },
    });
  }

  const photoSeed = seed.photo;
  if (!photoSeed) return;

  const photoExisting = await prisma.photoTemplate.findFirst({
    where: {
      OR: [
        { title: photoSeed.title },
        { title: "2" },
        { editPrompt: { contains: "titjob" } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const photoData = {
    title: photoSeed.title,
    tier: photoSeed.tier,
    editPrompt: photoSeed.editPrompt,
    pricePeaches: photoSeed.pricePeaches,
    previewImageUrl: photoSeed.previewImageUrl,
    sceneImageUrl: photoSeed.sceneImageUrl,
    published: true,
    sortOrder: 0,
  };

  if (photoExisting) {
    await prisma.photoTemplate.update({
      where: { id: photoExisting.id },
      data: {
        ...photoData,
        previewImageUrl:
          photoExisting.previewImageUrl?.startsWith("/api/media/") ||
          !photoExisting.previewImageUrl?.trim()
            ? photoSeed.previewImageUrl
            : photoExisting.previewImageUrl.includes("/tg/catalog/")
              ? photoSeed.previewImageUrl
              : photoExisting.previewImageUrl,
        sceneImageUrl:
          photoExisting.sceneImageUrl?.startsWith("/api/media/") ||
          !photoExisting.sceneImageUrl?.trim()
            ? photoSeed.sceneImageUrl
            : photoExisting.sceneImageUrl,
      },
    });
    return;
  }

  await prisma.photoTemplate.create({ data: photoData });
}

/** Creates / syncs launch catalog from bundled cabinet seed. */
export function ensureTgBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      try {
        await ensureStudioCastCharacters();
        await ensureFeaturedTemplates();
        void import("@/lib/tg/migrate-user-lora-lookbook")
          .then((m) => m.migrateUserLoraLookbookOverlayOff())
          .catch((e) => console.error("[tg/bootstrap] lookbook migrate:", e));
      } catch (e) {
        bootstrapPromise = null;
        console.error("[tg/bootstrap]", e);
        throw e;
      }
    })();
  }
  return bootstrapPromise;
}

export async function runTgBootstrapNow(): Promise<{
  videos: number;
  photos: number;
  casts: number;
}> {
  bootstrapPromise = null;
  await ensureTgBootstrap();
  const [videos, photos, casts] = await Promise.all([
    prisma.quickVideoTemplate.count({ where: { published: true } }),
    prisma.photoTemplate.count({ where: { published: true } }),
    prisma.character.count({
      where: { isStudioCast: true, loraStatus: "lora_ready" },
    }),
  ]);
  return { videos, photos, casts };
}
