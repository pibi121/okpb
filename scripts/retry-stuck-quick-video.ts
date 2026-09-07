/**
 * Re-queue a stuck quick-video run that is still "busy" with idle Comfy.
 *   npx tsx scripts/retry-stuck-quick-video.ts [runId]
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { composeQuickVideoPrompt, type QuickVideoImageSlot } from "../src/lib/quick-video-prompt";

const RUN_ID = process.argv[2] || "cmtbg9xq80005v94cj8f0rti1";
const prisma = new PrismaClient();

function parseJsonArray(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseRefSlots(raw: string): QuickVideoImageSlot[] {
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? (j as QuickVideoImageSlot[]) : [];
  } catch {
    return [];
  }
}

async function main() {
  const run = await prisma.quickVideoRun.findUnique({ where: { id: RUN_ID } });
  if (!run) throw new Error(`run not found: ${RUN_ID}`);
  console.log("retry", run.id, run.status, run.title);

  const refUrls = parseJsonArray(run.refImageUrlsJson);
  const refBuffers: Buffer[] = [];
  for (const url of refUrls) {
    const b = localBytesFromResultUrl(url);
    if (!b?.length) throw new Error(`missing ref ${url}`);
    refBuffers.push(b);
  }
  const imageSlots = parseRefSlots(run.refSlotsJson);
  const composed =
    run.composedPrompt ||
    composeQuickVideoPrompt(run.prompt, imageSlots, run.refVideoUrl ? 1 : 0);

  let refVideoBuffer: Buffer | null = null;
  if (run.refVideoUrl) {
    refVideoBuffer = localBytesFromResultUrl(run.refVideoUrl);
  }

  await prisma.quickVideoRun.update({
    where: { id: run.id },
    data: { status: "busy", error: null },
  });

  console.log("refs", refBuffers.length, "dur", run.durationSec, "composedLen", composed.length);
  const out = await runRef2VClip({
    refImageBuffers: refBuffers,
    refVideoBuffer,
    refVideoName: run.refVideoUrl ? "pose.mp4" : undefined,
    prompt: composed,
    width: run.width,
    height: run.height,
    durationSec: run.durationSec,
    filenamePrefix: `peach/quick_${run.id}`,
  });

  const saved = saveGalleryBinary(run.userId, "mp4", out.bytes, `quick_${run.id}`);
  const item = await prisma.galleryItem.create({
    data: {
      userId: run.userId,
      kind: "video",
      title: run.title,
      prompt: composed,
      resultUrl: saved.publicUrl,
      width: out.size.width,
      height: out.size.height,
      metaJson: JSON.stringify({
        status: "ready",
        engine: out.engine,
        quickVideoRunId: run.id,
        recovered: true,
      }),
    },
  });
  await prisma.quickVideoRun.update({
    where: { id: run.id },
    data: {
      status: "ready",
      resultVideoUrl: saved.publicUrl,
      galleryItemId: item.id,
      width: out.size.width,
      height: out.size.height,
      engine: out.engine,
      composedPrompt: out.prompt || composed,
      error: null,
    },
  });
  backupDatabase("retry-stuck-quick");
  console.log("READY", run.id, out.engine, saved.publicUrl);
}

main()
  .catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("FAIL", msg);
    try {
      await prisma.quickVideoRun.update({
        where: { id: RUN_ID },
        data: { status: "error", error: msg.slice(0, 2000) },
      });
    } catch {
      /* */
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
