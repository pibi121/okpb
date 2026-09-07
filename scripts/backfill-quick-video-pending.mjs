const GALLERY_PLACEHOLDER_URL = "/api/peach/gallery/placeholder";

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const busy = await p.quickVideoRun.findMany({
  where: { status: "busy", galleryItemId: null },
});

console.log(`Found ${busy.length} busy run(s) without gallery item`);

for (const run of busy) {
  const characterIds = (() => {
    try {
      const j = JSON.parse(run.characterIdsJson);
      return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();

  const item = await p.galleryItem.create({
    data: {
      userId: run.userId,
      characterId: characterIds[0] || null,
      kind: "video",
      title: run.title,
      prompt: run.composedPrompt || run.prompt,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      width: run.width,
      height: run.height,
      metaJson: JSON.stringify({
        status: "pending",
        jobAction: "quick_video",
        quickVideoRunId: run.id,
        characterIds,
        orientation: run.orientation,
        durationSec: run.durationSec,
        refImageUrls: (() => {
          try {
            return JSON.parse(run.refImageUrlsJson);
          } catch {
            return [];
          }
        })(),
        refVideoUrl: run.refVideoUrl,
        backfilled: true,
      }),
    },
  });

  await p.quickVideoRun.update({
    where: { id: run.id },
    data: { galleryItemId: item.id },
  });

  console.log(`Backfilled run ${run.id} -> gallery ${item.id}`);
}

await p.$disconnect();
