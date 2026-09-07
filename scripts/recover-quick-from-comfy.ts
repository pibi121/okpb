/**
 * Recover a quick-video that finished on GPU but stayed busy locally.
 *   npx tsx scripts/recover-quick-from-comfy.ts [runId]
 */
import { PrismaClient } from "@prisma/client";
import { comfyDownloadImage } from "../src/lib/comfy-client";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";

const RUN_ID = process.argv[2] || "cmtbia9bz0005v99c8a2k5sme";
const prisma = new PrismaClient();

async function main() {
  const run = await prisma.quickVideoRun.findUnique({ where: { id: RUN_ID } });
  if (!run) throw new Error(`run not found: ${RUN_ID}`);

  const filename = `quick_${RUN_ID}_00001_.mp4`;
  console.log("download", filename);
  const bytes = await comfyDownloadImage({
    filename,
    subfolder: "peach",
    type: "output",
  });
  if (!bytes?.length) throw new Error("empty download");

  const saved = saveGalleryBinary(run.userId, "mp4", bytes, `quick_${RUN_ID}`);
  const item = await prisma.galleryItem.create({
    data: {
      userId: run.userId,
      kind: "video",
      title: run.title,
      prompt: run.composedPrompt || run.prompt,
      resultUrl: saved.publicUrl,
      width: run.width,
      height: run.height,
      metaJson: JSON.stringify({
        status: "ready",
        engine: "minimax_h3_ref2v+recovered",
        quickVideoRunId: RUN_ID,
        recovered: true,
      }),
    },
  });
  await prisma.quickVideoRun.update({
    where: { id: RUN_ID },
    data: {
      status: "ready",
      resultVideoUrl: saved.publicUrl,
      galleryItemId: item.id,
      engine: "minimax_h3_ref2v+recovered",
      error: null,
    },
  });
  backupDatabase("recover-quick-comfy");
  console.log("READY", RUN_ID, saved.publicUrl, "bytes", bytes.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
