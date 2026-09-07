import { prisma } from "../src/lib/db";
import { localPathFromResultUrl } from "../src/lib/local-store";
import fs from "fs";
import path from "path";
import {
  TG_FEATURED_PHOTO_TITLES,
  TG_FEATURED_VIDEO_TITLES,
  TG_STUDIO_CAST_TRIGGERS,
} from "../src/lib/tg/tg-launch-constants";

const OUT_DIR = path.join(process.cwd(), "public", "tg", "catalog");
const SEED_PATH = path.join(process.cwd(), "src", "lib", "tg", "tg-catalog-seed.json");

type VideoSeed = {
  title: string;
  durationSec: number;
  shotsJson: string;
  slotBlueprintJson: string;
  identityPersonCount: number;
  previewVideoUrl: string;
  previewPhotoUrl: string;
};

type PhotoSeed = {
  title: string;
  tier: string;
  editPrompt: string;
  pricePeaches: number;
  previewImageUrl: string;
  sceneImageUrl: string;
};

type CastCoverSeed = { trigger: string; coverUrl: string };

function copyToCatalog(src: string | null, destName: string): string | null {
  if (!src || !fs.existsSync(src)) {
    console.warn("[skip] missing file:", src, "→", destName);
    return null;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, destName);
  fs.copyFileSync(src, dest);
  const publicUrl = `/tg/catalog/${destName}`;
  console.log("[copy]", destName, "←", path.basename(src));
  return publicUrl;
}

function extFromPath(p: string) {
  return path.extname(p) || ".bin";
}

async function main() {
  const videos: VideoSeed[] = [];
  for (let i = 0; i < TG_FEATURED_VIDEO_TITLES.length; i++) {
    const title = TG_FEATURED_VIDEO_TITLES[i]!;
    const row = await prisma.quickVideoTemplate.findFirst({
      where: { title },
    });
    if (!row) {
      console.warn("[video] not in DB:", title);
      continue;
    }
    const vSrc = localPathFromResultUrl(row.previewVideoUrl);
    const pSrc = localPathFromResultUrl(row.previewPhotoUrl);
    const vExt = extFromPath(vSrc || ".mp4");
    const pExt = extFromPath(pSrc || ".jpg");
    const previewVideoUrl =
      copyToCatalog(vSrc, `video-${i + 1}${vExt}`) || row.previewVideoUrl;
    const previewPhotoUrl =
      copyToCatalog(pSrc, `video-${i + 1}-thumb${pExt}`) || row.previewPhotoUrl;
    videos.push({
      title: row.title,
      durationSec: row.durationSec,
      shotsJson: row.shotsJson,
      slotBlueprintJson: row.slotBlueprintJson,
      identityPersonCount: row.identityPersonCount,
      previewVideoUrl,
      previewPhotoUrl,
    });
  }

  let photo: PhotoSeed | null = null;
  const photoRow =
    (await prisma.photoTemplate.findFirst({
      where: { title: TG_FEATURED_PHOTO_TITLES[0]! },
    })) ||
    (await prisma.photoTemplate.findFirst({
      where: { editPrompt: { contains: "titjob" } },
      orderBy: { createdAt: "desc" },
    }));
  if (photoRow) {
    const src = localPathFromResultUrl(
      photoRow.previewImageUrl || photoRow.sceneImageUrl,
    );
    const ext = extFromPath(src || ".png");
    const url = copyToCatalog(src, `photo-1${ext}`) || photoRow.previewImageUrl;
    photo = {
      title: TG_FEATURED_PHOTO_TITLES[0]!,
      tier: photoRow.tier,
      editPrompt: photoRow.editPrompt,
      pricePeaches: photoRow.pricePeaches,
      previewImageUrl: url,
      sceneImageUrl: url,
    };
  }

  const castCovers: CastCoverSeed[] = [];
  for (const trigger of TG_STUDIO_CAST_TRIGGERS) {
    const ch = await prisma.character.findFirst({
      where: { triggerWord: trigger, loraStatus: "lora_ready" },
    });
    if (!ch) continue;
    const gal = await prisma.galleryItem.findFirst({
      where: { characterId: ch.id, kind: "photo", resultUrl: { not: "" } },
      orderBy: { createdAt: "desc" },
    });
    if (!gal?.resultUrl) continue;
    const src = localPathFromResultUrl(gal.resultUrl);
    const ext = extFromPath(src || ".jpg");
    const url = copyToCatalog(src, `cast-${trigger}${ext}`);
    if (url) castCovers.push({ trigger, coverUrl: url });
  }

  const seed = { videos, photo, castCovers, syncedAt: new Date().toISOString() };
  fs.writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2), "utf8");
  console.log("\n[done] seed →", SEED_PATH);
  console.log(JSON.stringify(seed, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
